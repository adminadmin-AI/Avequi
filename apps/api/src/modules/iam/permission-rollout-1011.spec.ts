import {
  FASE_C2,
  FASE_C3,
  FASES,
  executarRollout,
  reverterRollout,
  ehLocal,
  resolverOpcoesDeTransacao,
  ROLLOUT_TRANSACTION_TIMEOUT_MS,
  ROLLOUT_TRANSACTION_MAX_WAIT_MS,
  Manifesto,
} from '../../../scripts/iam-permission-rollout';
import { SYSTEM_ROLES, resolveEffectivePermissions } from './roles.catalog';

/**
 * #1011 — o rollout estreito.
 *
 * Estes testes provam DUAS coisas, e a segunda é tão importante quanto a
 * primeira: que o comando faz o que promete, e que ele **não faz** o que o
 * seed completo faria — nada de espelhamento de enum, nada de reconciliação
 * que apaga vínculo manual.
 */
describe('#1011 — rollout de permissões C2/C3', () => {
  /** Prisma falso com estado em memória, para provar a lógica sem banco. */
  function fakePrisma(estado: {
    permissoes?: Array<{ id: string; code: string }>;
    perfis?: Array<{ id: string; code: string; parentId: string | null }>;
    vinculos?: Array<{ roleId: string; permissionId: string; id?: string }>;
  }) {
    const permissoes = [...(estado.permissoes ?? [])];
    const perfis = [...(estado.perfis ?? [])];
    const vinculos = [...(estado.vinculos ?? [])];
    let seq = 0;

    const criadas = { permission: 0, rolePermission: 0 };
    const removidas = { rolePermission: 0, permission: 0 };
    /** Tudo que NÃO deveria ser tocado por este comando. */
    const proibido = { userRoleAssignmentWrite: 0, userPermissionWrite: 0, deleteMany: 0 };

    const tx = {
      permission: {
        findMany: async ({ where }: any) =>
          permissoes.filter(
            (p) =>
              (where.code?.in ? where.code.in.includes(p.code) : true) &&
              (where.id?.in ? where.id.in.includes(p.id) : true),
          ),
        findFirst: async ({ where }: any) => permissoes.find((p) => p.code === where.code) ?? null,
        create: async ({ data }: any) => {
          const nova = { id: `perm-${++seq}`, code: data.code };
          permissoes.push(nova);
          criadas.permission++;
          return nova;
        },
        update: async () => ({}),
        delete: async ({ where }: any) => {
          const i = permissoes.findIndex((p) => p.id === where.id);
          if (i >= 0) permissoes.splice(i, 1);
          removidas.permission++;
          return {};
        },
      },
      role: {
        findMany: async ({ where }: any) =>
          perfis.filter(
            (r) =>
              (where.code?.in ? where.code.in.includes(r.code) : true) &&
              (where.id?.in ? where.id.in.includes(r.id) : true),
          ),
        findFirst: async ({ where }: any) => perfis.find((r) => r.code === where.code) ?? null,
        findUnique: async ({ where }: any) => perfis.find((r) => r.id === where.id) ?? null,
      },
      rolePermission: {
        findMany: async () => vinculos,
        create: async ({ data }: any) => {
          const novo = { id: `rp-${++seq}`, roleId: data.roleId, permissionId: data.permissionId };
          vinculos.push(novo);
          criadas.rolePermission++;
          return novo;
        },
        count: async ({ where }: any) =>
          vinculos.filter((v) => v.permissionId === where.permissionId).length,
        deleteMany: async ({ where }: any) => {
          proibido.deleteMany++;
          const antes = vinculos.length;
          for (const id of where.id?.in ?? []) {
            const i = vinculos.findIndex((v) => v.id === id);
            if (i >= 0) vinculos.splice(i, 1);
          }
          removidas.rolePermission += antes - vinculos.length;
          return { count: antes - vinculos.length };
        },
      },
      userPermission: {
        count: async () => 0,
        create: async () => {
          proibido.userPermissionWrite++;
          return {};
        },
        deleteMany: async () => {
          proibido.userPermissionWrite++;
          return { count: 0 };
        },
      },
      userRoleAssignment: {
        findMany: async () => [],
        count: async () => 0,
        create: async () => {
          proibido.userRoleAssignmentWrite++;
          return {};
        },
      },
      company: { findMany: async () => [] },
    };

    /** Toda invocação de $transaction, com as opções que recebeu (#1014). */
    const transacoes: Array<{ opcoes: any }> = [];

    const prisma: any = {
      ...tx,
      $transaction: async (fn: any, opcoes?: any) => {
        transacoes.push({ opcoes });
        return fn(tx);
      },
      _criadas: criadas,
      _removidas: removidas,
      _proibido: proibido,
      _vinculos: vinculos,
      _permissoes: permissoes,
      _transacoes: transacoes,
    };
    return prisma;
  }

  const perfisDe = (codes: string[]) =>
    codes.map((code, i) => ({ id: `role-${i}`, code, parentId: null }));

  // ── Coerência com o catálogo ───────────────────────────────────────────────

  it('a lista do rollout bate com a matriz do catálogo — duplicação sem divergência', () => {
    // A lista é declarada no script de propósito (auditabilidade). Este teste
    // é o que impede a duplicação de virar divergência silenciosa.
    //
    // A comparação só vale para permissões que JÁ estão no catálogo desta
    // branch: o rollout precede o merge do código que as introduz. Hoje a
    // `crm.leads.assignable` só existe na branch da C3 (#1012) — quando ela
    // mergear, este teste passa a cobri-la automaticamente, sem edição.
    const noCatalogo = (code: string) =>
      (SYSTEM_ROLES as { code: string }[])
        .filter((r) => resolveEffectivePermissions(r.code).includes(code))
        .map((r) => r.code)
        .sort();

    const cobertos = [...FASE_C2, ...FASE_C3].filter((a) => noCatalogo(a.code).length > 0);
    // A Fase A é sempre comparável: a C2 já está na main.
    expect(cobertos.map((a) => a.code)).toEqual(expect.arrayContaining(FASE_C2.map((a) => a.code)));

    for (const alvo of cobertos) {
      const noRollout = [...alvo.roles, ...(alvo.porHeranca ?? []).map((h) => h.role)].sort();
      expect({ [alvo.code]: noRollout }).toEqual({ [alvo.code]: noCatalogo(alvo.code) });
    }
  });

  it('--phase=all é ATÔMICO: se a C3 falhar, a C2 não fica aplicada', async () => {
    // Uma transação só para as duas fases. Sem isso, `all` poderia deixar a C2
    // gravada e a C3 fora — estado parcial que ninguém sabe descrever depois.
    const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) }); // faltam os da C3

    await expect(executarRollout(prisma, 'all')).rejects.toThrow(/perfis obrigatórios ausentes/);

    // nada da C2 foi gravado, mesmo ela estando completa
    expect(prisma._criadas.permission).toBe(0);
    expect(prisma._criadas.rolePermission).toBe(0);
  });

  it('as fases estão separadas: c2 tem duas permissões, c3 tem uma', () => {
    expect(FASE_C2.map((a) => a.code).sort()).toEqual([
      'iam.sessions.revoke-any',
      'sales.commissions.view-all',
    ]);
    expect(FASE_C3.map((a) => a.code)).toEqual(['crm.leads.assignable']);
    expect(FASES.all).toHaveLength(3);
  });

  it('LOJA_FATURAMENTO está como HERANÇA, não como vínculo direto', () => {
    const c3 = FASE_C3[0];
    expect(c3.roles).not.toContain('LOJA_FATURAMENTO');
    expect(c3.porHeranca).toEqual([{ role: 'LOJA_FATURAMENTO', via: 'LOJA_OPERACIONAL' }]);
  });

  // ── Fase A ─────────────────────────────────────────────────────────────────

  describe('Fase A (c2)', () => {
    const perfisC2 = perfisDe(FASE_C2[0].roles);

    it('cria as duas permissões quando ausentes e associa os perfis aprovados', async () => {
      const prisma = fakePrisma({ perfis: perfisC2 });
      const rel = await executarRollout(prisma, 'c2');

      expect(rel.permissoesAusentes.sort()).toEqual([
        'iam.sessions.revoke-any',
        'sales.commissions.view-all',
      ]);
      expect(prisma._criadas.permission).toBe(2);
      // 11 do view-all + 2 do revoke-any
      expect(prisma._criadas.rolePermission).toBe(13);
      expect(rel.manifesto!.permissoesCriadas).toHaveLength(2);
      expect(rel.manifesto!.vinculosCriados).toHaveLength(13);
    });

    it('preserva permissão que já existe — upsert, não recriação', async () => {
      const prisma = fakePrisma({
        perfis: perfisC2,
        permissoes: [{ id: 'p-existente', code: 'sales.commissions.view-all' }],
      });
      const rel = await executarRollout(prisma, 'c2');

      expect(rel.permissoesExistentes).toContain('sales.commissions.view-all');
      expect(prisma._criadas.permission).toBe(1); // só a revoke-any
      expect(rel.manifesto!.permissoesCriadas).toEqual(['iam.sessions.revoke-any']);
    });

    it('SEGUNDA execução não muda nada — idempotência', async () => {
      const prisma = fakePrisma({ perfis: perfisC2 });
      await executarRollout(prisma, 'c2');
      const antesP = prisma._criadas.permission;
      const antesV = prisma._criadas.rolePermission;

      const rel2 = await executarRollout(prisma, 'c2');

      expect(prisma._criadas.permission).toBe(antesP);
      expect(prisma._criadas.rolePermission).toBe(antesV);
      expect(rel2.vinculosACriar).toEqual([]);
      expect(rel2.manifesto!.vinculosCriados).toEqual([]);
    });

    it('ADMIN_FILIAL não recebe revoke-any e GERENTE_INDUSTRIAL não recebe view-all', () => {
      const revokeAny = FASE_C2.find((a) => a.code === 'iam.sessions.revoke-any')!;
      const viewAll = FASE_C2.find((a) => a.code === 'sales.commissions.view-all')!;
      expect(revokeAny.roles).toEqual(['ADMIN_GLOBAL', 'ADMIN_EMPRESA']);
      expect(revokeAny.roles).not.toContain('ADMIN_FILIAL');
      expect(viewAll.roles).not.toContain('GERENTE_INDUSTRIAL');
    });

    it('ABORTA quando falta perfil obrigatório — nada é aplicado', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(['ADMIN_GLOBAL']) });

      await expect(executarRollout(prisma, 'c2')).rejects.toThrow(/perfis obrigatórios ausentes/);
      expect(prisma._criadas.permission).toBe(0);
      expect(prisma._criadas.rolePermission).toBe(0);
    });
  });

  // ── Fase B ─────────────────────────────────────────────────────────────────

  describe('Fase B (c3)', () => {
    const perfisC3 = [
      ...perfisDe(FASE_C3[0].roles),
      { id: 'role-lojaop', code: 'LOJA_OPERACIONAL', parentId: null },
      { id: 'role-lojafat', code: 'LOJA_FATURAMENTO', parentId: 'role-lojaop' },
    ];

    it('cria a permissão e associa os CINCO perfis diretos — nunca LOJA_FATURAMENTO', async () => {
      const prisma = fakePrisma({ perfis: perfisC3 });
      const rel = await executarRollout(prisma, 'c3');

      expect(prisma._criadas.rolePermission).toBe(5);
      const roles = rel.manifesto!.vinculosCriados.map((v) => v.roleCode).sort();
      expect(roles).toEqual([
        'COORDENADOR_COMERCIAL',
        'GERENTE_COMERCIAL',
        'GERENTE_LOJA',
        'LOJA_OPERACIONAL',
        'VENDEDOR',
      ]);
      expect(roles).not.toContain('LOJA_FATURAMENTO');
    });

    it('valida a cadeia de herança sem alterá-la', async () => {
      const prisma = fakePrisma({ perfis: perfisC3 });
      const rel = await executarRollout(prisma, 'c3', { dryRun: true });

      expect(rel.heranca).toEqual([
        { role: 'LOJA_FATURAMENTO', via: 'LOJA_OPERACIONAL', cadeiaOk: true },
      ]);
    });

    it('ABORTA se a cadeia de herança estiver divergente', async () => {
      const prisma = fakePrisma({
        perfis: [
          ...perfisDe(FASE_C3[0].roles),
          { id: 'role-lojaop', code: 'LOJA_OPERACIONAL', parentId: null },
          { id: 'role-lojafat', code: 'LOJA_FATURAMENTO', parentId: null }, // sem pai
        ],
      });

      await expect(executarRollout(prisma, 'c3')).rejects.toThrow(/herança divergente/);
      expect(prisma._criadas.rolePermission).toBe(0);
    });

    it('administradores não recebem a elegibilidade', () => {
      for (const admin of ['ADMIN_GLOBAL', 'ADMIN_EMPRESA', 'ADMIN_FILIAL', 'DIRETOR']) {
        expect(FASE_C3[0].roles).not.toContain(admin);
      }
    });
  });

  // ── O que o comando NÃO faz ────────────────────────────────────────────────

  describe('escopo estreito — o que o seed faria e este comando não faz', () => {
    it('NUNCA cria UserRoleAssignment — não executa o espelhamento do enum', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      await executarRollout(prisma, 'c2');

      expect(prisma._proibido.userRoleAssignmentWrite).toBe(0);
    });

    it('NUNCA escreve em UserPermission — grants e denies individuais intocados', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      await executarRollout(prisma, 'c2');

      expect(prisma._proibido.userPermissionWrite).toBe(0);
    });

    it('NÃO reconcilia o catálogo: vínculo alheio preexistente sobrevive', async () => {
      // É o cenário do #889 — permissão concedida manualmente a um perfil
      // system. O seed apagaria; este comando não encosta.
      const prisma = fakePrisma({
        perfis: perfisDe(FASE_C2[0].roles),
        vinculos: [{ id: 'rp-manual', roleId: 'role-0', permissionId: 'perm-de-outra-coisa' }],
      });
      await executarRollout(prisma, 'c2');

      expect(prisma._vinculos.some((v: any) => v.id === 'rp-manual')).toBe(true);
      expect(prisma._proibido.deleteMany).toBe(0);
    });

    it('não chama o seed completo em nenhum caminho', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // Sem comentários: a própria explicação de por que o seed não é usado
      // cita o nome dele.
      const src: string = require('fs')
        .readFileSync('scripts/iam-permission-rollout.ts', 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/seedIam|db:seed|iam\.seed/);
    });
  });

  // ── Dry-run ────────────────────────────────────────────────────────────────

  describe('dry-run', () => {
    it('não escreve nada e ainda assim relata o que faria', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2', { dryRun: true });

      expect(prisma._criadas.permission).toBe(0);
      expect(prisma._criadas.rolePermission).toBe(0);
      expect(rel.manifesto).toBeUndefined();
      expect(rel.vinculosACriar).toHaveLength(13);
      expect(rel.permissoesAusentes).toHaveLength(2);
    });

    it('o relatório traz contagens, não dados pessoais', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2', { dryRun: true });

      const texto = JSON.stringify(rel);
      expect(texto).not.toMatch(/senha|password|token|email|@|cpf|cnpj/i);
      expect(typeof rel.usuariosComDenyIndividual).toBe('number');
      expect(typeof rel.usuariosComGrantIndividual).toBe('number');
      expect(typeof rel.usuariosAfetados).toBe('number');
    });

    it('aborta ANTES de escrever quando falta perfil, mas o dry-run só relata', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(['ADMIN_GLOBAL']) });
      const rel = await executarRollout(prisma, 'c2', { dryRun: true });

      expect(rel.perfisObrigatoriosAusentes.length).toBeGreaterThan(0);
      expect(prisma._criadas.permission).toBe(0);
    });
  });

  // ── Rollback ───────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('remove SOMENTE o que aquela execução criou', async () => {
      const prisma = fakePrisma({
        perfis: perfisDe(FASE_C2[0].roles),
        vinculos: [{ id: 'rp-preexistente', roleId: 'role-0', permissionId: 'perm-antiga' }],
      });
      const rel = await executarRollout(prisma, 'c2');
      const criados = rel.manifesto!.vinculosCriados.length;

      const r = await reverterRollout(prisma, rel.manifesto!);

      expect(r.vinculosRemovidos).toBe(criados);
      // o vínculo que já existia continua lá
      expect(prisma._vinculos.some((v: any) => v.id === 'rp-preexistente')).toBe(true);
    });

    it('não remove permissão que ficou com outros vínculos', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2');
      // alguém associou a permissão a outro perfil depois do rollout
      prisma._vinculos.push({
        id: 'rp-de-terceiro',
        roleId: 'role-outro',
        permissionId: prisma._permissoes[0].id,
      });

      const r = await reverterRollout(prisma, rel.manifesto!);

      expect(r.permissoesRemovidas).not.toContain(prisma._permissoes[0].code);
    });

    it('não toca UserPermission durante o rollback', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2');
      await reverterRollout(prisma, rel.manifesto!);

      expect(prisma._proibido.userPermissionWrite).toBe(0);
      expect(prisma._proibido.userRoleAssignmentWrite).toBe(0);
    });

    it('NÃO remove vínculo que deixou de ser o nosso — id reaproveitado por outra config', async () => {
      // Cenário: depois do rollout, alguém reconfigurou o perfil e aquele id
      // passou a descrever outro par role×permission. Desfazer configuração
      // alheia seria pior que não desfazer nada.
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2');
      const alvo = rel.manifesto!.vinculosCriados[0];
      // o registro com aquele id agora aponta para outro perfil
      const linha = prisma._vinculos.find((v: any) => v.id === alvo.id);
      linha.roleId = 'role-completamente-outro';

      const r = await reverterRollout(prisma, rel.manifesto!);

      expect(prisma._vinculos.some((v: any) => v.id === alvo.id)).toBe(true);
      expect(r.vinculosRemovidos).toBe(rel.manifesto!.vinculosCriados.length - 1);
    });

    it('repetir o rollback é seguro', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2');
      const manifesto: Manifesto = rel.manifesto!;

      await reverterRollout(prisma, manifesto);
      const segunda = await reverterRollout(prisma, manifesto);

      expect(segunda.vinculosRemovidos).toBe(0);
    });
  });

  // ── Proteção contra host remoto ────────────────────────────────────────────

  describe('proteção de host', () => {
    it.each([
      ['postgresql://u:p@localhost:5432/db'],
      ['postgresql://u:p@127.0.0.1:5432/db'],
      ['postgresql://u:p@127.1.2.3:5432/db'], // 127.0.0.0/8 inteiro é loopback
      ['postgresql://u:p@[::1]:5432/db'],
      ['postgresql://u:p@postgres:5432/db'], // serviço de compose/CI
    ])('aceita loopback: %s', (url) => {
      expect(ehLocal(url)).toBe(true);
    });

    it.each([
      ['postgresql://u:p@db.supabase.co:5432/postgres'],
      ['postgresql://u:p@containers-us-west.railway.app:5432/db'],
      // Rede privada NÃO é loopback: um banco "da rede" é o banco de alguém.
      ['postgresql://u:p@192.168.0.29:5432/db'],
      ['postgresql://u:p@10.0.0.5:5432/db'],
      ['postgresql://u:p@172.16.4.2:5432/db'],
    ])('recusa host remoto ou de rede: %s', (url) => {
      expect(ehLocal(url)).toBe(false);
    });

    it('fail-closed: URL malformada ou ausente não é local', () => {
      // Na dúvida o comando não roda — ele ESCREVE em perfis.
      expect(ehLocal('')).toBe(false);
      expect(ehLocal('não-é-url')).toBe(false);
      expect(ehLocal(undefined as unknown as string)).toBe(false);
    });

    it('a proteção vale também para dry-run — está no CLI, antes de conectar', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const src: string = require('fs').readFileSync('scripts/iam-permission-rollout.ts', 'utf-8');
      const cli = src.split('async function main()')[1];
      // a checagem acontece antes de instanciar o PrismaClient
      expect(cli.indexOf('ehLocal(url)')).toBeLessThan(cli.indexOf('new PrismaClient()'));
      // e o dry-run não a contorna: não há exceção condicional para ele
      expect(cli).not.toMatch(/dryRun\s*\|\|\s*ehLocal|ehLocal\(url\)\s*\|\|\s*dryRun/);
    });

    it('a mensagem de erro não imprime a URL nem a senha', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const src: string = require('fs').readFileSync('scripts/iam-permission-rollout.ts', 'utf-8');
      const bloco = src.split('ABORTADO: DATABASE_URL')[1].split(');')[0];
      expect(bloco).not.toMatch(/\$\{url\}|\+ url|, url/);
    });
  });

  // ── Manifesto ──────────────────────────────────────────────────────────────

  it('o manifesto guarda só identificadores técnicos', async () => {
    const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
    const rel = await executarRollout(prisma, 'c2');
    const m = rel.manifesto!;

    expect(Object.keys(m).sort()).toEqual([
      'execucaoId',
      'fase',
      'permissoesCriadas',
      'timestamp',
      'vinculosCriados',
    ]);
    expect(JSON.stringify(m)).not.toMatch(/senha|token|email|@/i);
  });
  // ── Limites da transação (#1014) ───────────────────────────────────────────

  describe('limites da transação — a falha de 05/08 no pooler', () => {
    /**
     * A Fase A morreu no banco real com "Transaction not found": o comando
     * abria a transação SEM opções e o padrão do Prisma é 5 s, contra ~1,05 s
     * de ida-e-volta e 15 escritas sequenciais. Nada ficou pela metade — a
     * transação reverteu tudo —, mas o comando ficou inutilizável justamente
     * contra banco remoto, que é onde ele precisa rodar.
     *
     * Estes testes existem para que ninguém volte ao padrão sem perceber.
     */
    const esperado = {
      timeout: ROLLOUT_TRANSACTION_TIMEOUT_MS,
      maxWait: ROLLOUT_TRANSACTION_MAX_WAIT_MS,
    };

    it('os padrões são folgados o bastante para a Fase A no pooler', () => {
      // 15 escritas sequenciais a ~1,05 s medidos = ~15,8 s. 120 s dá folga
      // para uma rede bem pior sem virar espera infinita.
      expect(ROLLOUT_TRANSACTION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
      expect(ROLLOUT_TRANSACTION_MAX_WAIT_MS).toBeGreaterThanOrEqual(10_000);
    });

    it('Fase A abre a transação com timeout e maxWait EXPLÍCITOS', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      await executarRollout(prisma, 'c2');

      expect(prisma._transacoes).toHaveLength(1);
      expect(prisma._transacoes[0].opcoes).toEqual(esperado);
    });

    /** A Fase B confere a cadeia LOJA_OPERACIONAL → LOJA_FATURAMENTO. */
    const comCadeia = (codes: string[]) => [
      ...perfisDe(codes.filter((c) => c !== 'LOJA_OPERACIONAL')),
      { id: 'role-lojaop', code: 'LOJA_OPERACIONAL', parentId: null },
      { id: 'role-lojafat', code: 'LOJA_FATURAMENTO', parentId: 'role-lojaop' },
    ];

    it('Fase B abre a transação com as mesmas opções', async () => {
      const prisma = fakePrisma({ perfis: comCadeia(FASE_C3[0].roles) });
      await executarRollout(prisma, 'c3');

      expect(prisma._transacoes[0].opcoes).toEqual(esperado);
    });

    it('--phase=all continua UMA transação só, e com as opções', async () => {
      const todos = [...new Set(FASES.all.flatMap((a) => a.roles))];
      const prisma = fakePrisma({ perfis: comCadeia(todos) });
      await executarRollout(prisma, 'all');

      expect(prisma._transacoes).toHaveLength(1); // atomicidade preservada
      expect(prisma._transacoes[0].opcoes).toEqual(esperado);
    });

    it('o ROLLBACK também recebe as opções — desfazer não pode esbarrar em 5 s', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      const rel = await executarRollout(prisma, 'c2');
      const antes = prisma._transacoes.length;

      await reverterRollout(prisma, rel.manifesto as Manifesto);

      expect(prisma._transacoes).toHaveLength(antes + 1);
      expect(prisma._transacoes[antes].opcoes).toEqual(esperado);
    });

    it('dry-run não abre transação nenhuma', async () => {
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      await executarRollout(prisma, 'c2', { dryRun: true });

      expect(prisma._transacoes).toHaveLength(0);
    });

    it('SEM RETRY: transação que falha é UMA transação, e o erro sobe', async () => {
      // Retry automático esconderia problema de conectividade e deixaria
      // dúvida sobre qual execução produziu o manifesto. Quem repete é o
      // operador, depois de olhar a falha.
      const prisma = fakePrisma({ perfis: perfisDe(FASE_C2[0].roles) });
      prisma.$transaction = async (_fn: any, opcoes?: any) => {
        prisma._transacoes.push({ opcoes });
        throw new Error('Transaction API error: Transaction not found');
      };

      await expect(executarRollout(prisma, 'c2')).rejects.toThrow(/Transaction not found/);
      expect(prisma._transacoes).toHaveLength(1);
      expect(prisma._criadas.permission).toBe(0);
      expect(prisma._criadas.rolePermission).toBe(0);
      expect(prisma._proibido.userPermissionWrite).toBe(0);
      expect(prisma._proibido.userRoleAssignmentWrite).toBe(0);
    });

    it('override por ambiente: só as variáveis DESTE comando, e validadas', () => {
      expect(resolverOpcoesDeTransacao({})).toEqual(esperado);

      expect(
        resolverOpcoesDeTransacao({
          IAM_ROLLOUT_TX_TIMEOUT_MS: '180000',
          IAM_ROLLOUT_TX_MAX_WAIT_MS: '30000',
        }),
      ).toEqual({ timeout: 180_000, maxWait: 30_000 });

      // Variável genérica de outro contexto não muda nada aqui
      expect(resolverOpcoesDeTransacao({ TX_TIMEOUT: '1', DATABASE_TIMEOUT: '1' } as any)).toEqual(
        esperado,
      );
    });

    it('valor inválido falha ANTES de conectar, com mensagem que ensina', () => {
      for (const bruto of ['abc', '12.5', '4999', '600001', '-1']) {
        expect(() => resolverOpcoesDeTransacao({ IAM_ROLLOUT_TX_TIMEOUT_MS: bruto })).toThrow(
          /IAM_ROLLOUT_TX_TIMEOUT_MS/,
        );
      }
      for (const bruto of ['abc', '999', '120001']) {
        expect(() => resolverOpcoesDeTransacao({ IAM_ROLLOUT_TX_MAX_WAIT_MS: bruto })).toThrow(
          /IAM_ROLLOUT_TX_MAX_WAIT_MS/,
        );
      }
      // Vazio e ausente caem no padrão, não em erro
      expect(resolverOpcoesDeTransacao({ IAM_ROLLOUT_TX_TIMEOUT_MS: '' })).toEqual(esperado);
    });

    it('REGRESSÃO: as duas transações do script passam opções — nunca o padrão de 5 s', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const src: string = require('fs').readFileSync('scripts/iam-permission-rollout.ts', 'utf-8');
      const chamadas = src.match(/await prisma\.\$transaction\(/g) ?? [];
      expect(chamadas).toHaveLength(2); // aplicação e rollback

      // Nenhuma delas pode fechar sem passar as opções: `}, transacao)`.
      const comOpcoes = src.match(/\}, transacao\);/g) ?? [];
      expect(comOpcoes).toHaveLength(2);

      // E nada de retry costurado no meio do caminho: a palavra pode aparecer
      // em COMENTÁRIO (explicando por que não existe), nunca em código. O
      // comportamento em si é provado pelo teste "SEM RETRY" acima e pelo spec
      // de integração; isto aqui é a trava contra quem, num timeout futuro,
      // resolver "consertar" repetindo a operação.
      const retryEmCodigo = src.match(/^(?!\s*(\*|\/\/|\/\*)).*(retry|tentativas).*$/gim) ?? [];
      expect(retryEmCodigo).toEqual([]);
    });

    it('a matriz aprovada continua exatamente a mesma', () => {
      expect(FASE_C2.map((a) => `${a.code}:${a.roles.length}`)).toEqual([
        'sales.commissions.view-all:11',
        'iam.sessions.revoke-any:2',
      ]);
      expect(FASE_C3.map((a) => `${a.code}:${a.roles.length}`)).toEqual([
        'crm.leads.assignable:5',
      ]);
    });
  });
});
