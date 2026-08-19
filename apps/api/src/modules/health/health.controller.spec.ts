import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController, HEALTH_TIMEOUT_MS } from './health.controller';
import { HealthRedis } from './health.redis';
import { PrismaService } from '../../prisma/prisma.service';

/** Resposta fake do Express: so guarda o status que o controller escreveu. */
const fakeRes = () => {
  const r: any = { statusCode: 0 };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  return r;
};

const fakeConfig = () => ({ get: () => 'redis://localhost:6379' }) as unknown as ConfigService;

describe('HealthController (#1102)', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ um: 1 }]) };
    redis = { ping: jest.fn().mockResolvedValue(true) };
    const mod = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: HealthRedis, useValue: redis },
      ],
    }).compile();
    controller = mod.get(HealthController);
    jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);
  });

  // 1. tudo no ar
  it('banco UP + Redis UP -> healthy, HTTP 200', async () => {
    const res = fakeRes();
    const body = await controller.health(res);
    expect(body.status).toBe('healthy');
    expect(body.checks).toEqual({ database: 'up', redis: 'up' });
    expect(res.statusCode).toBe(200);
  });

  // 2. banco fora
  it('banco DOWN -> unhealthy, HTTP 503', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = fakeRes();
    const body = await controller.health(res);
    expect(body.status).toBe('unhealthy');
    expect(body.checks.database).toBe('down');
    expect(res.statusCode).toBe(503);
  });

  // 3. Redis fora NAO derruba (decisao do Rafael, 19/08)
  it('banco UP + Redis DOWN -> degraded, HTTP 200 (nunca 503)', async () => {
    redis.ping.mockResolvedValue(false);
    const res = fakeRes();
    const body = await controller.health(res);
    expect(body.status).toBe('degraded');
    expect(body.checks).toEqual({ database: 'up', redis: 'down' });
    // A trava que importa: Redis fora NAO e indisponibilidade. Devolver 503
    // aqui produziria downtime falso na apuracao de SLA (#1024).
    expect(res.statusCode).toBe(200);
  });

  // 4. ambos fora
  it('banco DOWN + Redis DOWN -> unhealthy, HTTP 503 (o banco manda)', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('down'));
    redis.ping.mockResolvedValue(false);
    const res = fakeRes();
    const body = await controller.health(res);
    expect(body.status).toBe('unhealthy');
    expect(body.checks).toEqual({ database: 'down', redis: 'down' });
    expect(res.statusCode).toBe(503);
  });

  // 5. SEM VAZAMENTO — a trava mais importante do arquivo
  it('erro interno NUNCA vaza para o corpo da resposta', async () => {
    const segredo =
      'FATAL: password authentication failed for user "postgres.avliarleak" ' +
      'host=aws-1-us-west-2.pooler.supabase.com port=6543 password=SenhaSuperSecreta123';
    const erro = new Error(segredo);
    erro.stack =
      'Error: ' + segredo + '\n    at PrismaClient.$queryRaw (/app/node_modules/@prisma/client/index.js:1:1)';
    prisma.$queryRaw.mockRejectedValue(erro);
    redis.ping.mockRejectedValue(new Error('redis://user:senha@10.0.0.7:6379 ECONNREFUSED'));

    const body = await controller.health(fakeRes());
    const json = JSON.stringify(body);

    const proibidos = [
      'password',
      'senha',
      'Senha',
      'FATAL',
      'postgres',
      'supabase',
      'pooler',
      'aws-1',
      '6543',
      '6379',
      '10.0.0.7',
      'redis://',
      'prisma',
      'Prisma',
      'node_modules',
      'PrismaClient',
      'ECONNREFUSED',
      'stack',
      'Error',
      'authentication',
    ];
    for (const proibido of proibidos) {
      expect(json).not.toContain(proibido);
    }
    expect(body.status).toBe('unhealthy');
  });

  // 6. formato fechado
  it('resposta tem vocabulario fechado e nenhuma chave extra', async () => {
    const combinacoes: [boolean, boolean][] = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ];
    for (const [db, rd] of combinacoes) {
      prisma.$queryRaw.mockImplementation(() =>
        db ? Promise.resolve([1]) : Promise.reject(new Error('x')),
      );
      redis.ping.mockResolvedValue(rd);
      const body = await controller.health(fakeRes());

      expect(Object.keys(body).sort()).toEqual(['checks', 'status', 'uptime']);
      expect(Object.keys(body.checks).sort()).toEqual(['database', 'redis']);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
      expect(['up', 'down']).toContain(body.checks.database);
      expect(['up', 'down']).toContain(body.checks.redis);
      expect(Number.isInteger(body.uptime)).toBe(true);
    }
  });

  // 7. timeout nao pendura a requisicao
  it('dependencia que trava vira down dentro do prazo, sem pendurar', async () => {
    jest.useFakeTimers();
    // Nunca resolve: simula conexao pendurada (o pior caso de um health check).
    prisma.$queryRaw.mockImplementation(() => new Promise(() => undefined));
    redis.ping.mockImplementation(() => new Promise(() => undefined));

    const res = fakeRes();
    const promessa = controller.health(res);
    await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 10);
    const body = await promessa;

    expect(body.checks).toEqual({ database: 'down', redis: 'down' });
    expect(body.status).toBe('unhealthy');
    expect(res.statusCode).toBe(503);
    jest.useRealTimers();
  });

  // 8. cabecalho anti-cache
  it('declara Cache-Control: no-store', () => {
    const headers = Reflect.getMetadata('__headers__', HealthController.prototype.health);
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Cache-Control', value: 'no-store' }),
      ]),
    );
  });

  // 9. rota publica
  it('e publica — o monitor externo nao tem credencial', () => {
    expect(Reflect.getMetadata('isPublic', HealthController.prototype.health)).toBe(true);
  });
});

describe('HealthRedis (#1102)', () => {
  // 10. reaproveitamento do client
  it('reaproveita UMA conexao entre requisicoes (nao abre uma por chamada)', async () => {
    const service = new HealthRedis(fakeConfig());
    const cliente: any = { ping: jest.fn().mockResolvedValue('PONG'), on: jest.fn() };
    const getter = jest.spyOn(service as any, 'getClient').mockReturnValue(cliente);

    for (let i = 0; i < 5; i++) {
      expect(await service.ping()).toBe(true);
    }

    expect(getter).toHaveBeenCalledTimes(5);
    expect(cliente.ping).toHaveBeenCalledTimes(5);
    // Todas as chamadas usaram a MESMA instancia.
    expect(getter.mock.results.every((r) => r.value === cliente)).toBe(true);
  });

  it('client em cache e devolvido sem construir outro', () => {
    const service = new HealthRedis(fakeConfig());
    const cliente: any = { on: jest.fn() };
    (service as any).client = cliente;
    expect((service as any).getClient()).toBe(cliente);
    expect((service as any).getClient()).toBe(cliente);
  });

  it('ping nunca lanca: falha do Redis vira false', async () => {
    const service = new HealthRedis(fakeConfig());
    (service as any).client = { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await expect(service.ping()).resolves.toBe(false);
  });

  it('sem client disponivel devolve false em vez de estourar', async () => {
    const service = new HealthRedis(fakeConfig());
    (service as any).clientFailed = true;
    await expect(service.ping()).resolves.toBe(false);
  });
});
