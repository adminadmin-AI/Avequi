import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { FiscalClientService } from './fiscal-client.service';

// #1077 — NFS-e Nacional (/v2/nfsen). SJP aderiu ao ambiente nacional.
describe('FiscalClientService — NFS-e Nacional (#1077)', () => {
  const ENVS: Record<string, string> = {
    FOCUS_NFE_BASE_URL: 'https://homologacao.focusnfe.com.br',
    FOCUS_NFE_TOKEN: 'token-global',
    FOCUS_NFE_TOKEN__co_usija: 'token-da-usinagem',
  };

  let client: FiscalClientService;
  let http: { post: jest.Mock; get: jest.Mock; delete: jest.Mock };

  const build = async (responses: Partial<Record<'post' | 'get' | 'delete', any>> = {}) => {
    http = {
      post: jest.fn().mockReturnValue(of({ data: responses.post ?? { status: 'autorizado' } })),
      get: jest.fn().mockReturnValue(of({ data: responses.get ?? { status: 'autorizado' } })),
      delete: jest.fn().mockReturnValue(of({ data: responses.delete ?? { status: 'cancelado' } })),
    };
    const module = await Test.createTestingModule({
      providers: [
        FiscalClientService,
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: { get: (k: string, d = '') => ENVS[k] ?? d } },
      ],
    }).compile();
    client = module.get(FiscalClientService);
  };

  it('emite no endpoint nacional /v2/nfsen — não no padrão municipal antigo', async () => {
    await build();
    await client.emitNFSe('dps-1', { valor_servico: 1000 });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/v2/nfsen?ref=dps-1'),
      { valor_servico: 1000 },
      expect.anything(),
    );
  });

  it('reaproveita o token por company da NF-e (#695)', async () => {
    await build();
    await client.emitNFSe('dps-1', {}, 'co_usija');
    expect(http.post).toHaveBeenCalledWith(
      expect.anything(),
      {},
      expect.objectContaining({ auth: { username: 'token-da-usinagem', password: '' } }),
    );
  });

  it('cai no token global quando a company não tem token próprio', async () => {
    await build();
    await client.emitNFSe('dps-1', {}, 'co_desconhecida');
    expect(http.post).toHaveBeenCalledWith(
      expect.anything(),
      {},
      expect.objectContaining({ auth: { username: 'token-global', password: '' } }),
    );
  });

  it('cancelamento manda a justificativa no corpo do DELETE', async () => {
    await build();
    await client.cancelNFSe('dps-1', 'servico nao prestado');
    expect(http.delete).toHaveBeenCalledWith(
      expect.stringContaining('/v2/nfsen/dps-1'),
      expect.objectContaining({ data: { justificativa: 'servico nao prestado' } }),
    );
  });

  it('consulta de status usa GET /v2/nfsen/:ref', async () => {
    await build();
    await client.getNfseStatus('dps-1');
    expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/v2/nfsen/dps-1'), expect.anything());
  });

  // ── Normalização defensiva ──
  // Os nomes de campo da RESPOSTA não estão na doc aberta da Focus. O adapter
  // aceita os apelidos plausíveis para não quebrar na 1ª emissão real.
  describe('normalização da resposta', () => {
    it('aceita os nomes esperados', async () => {
      await build({
        post: {
          status: 'autorizado',
          numero_nfse: '35',
          chave_acesso: 'NFS35000000000000000000000000000000000000000000000',
          caminho_danfse: '/nfse/danfse.pdf',
          caminho_xml_nota_fiscal: '/nfse/nota.xml',
        },
      });
      const r = await client.emitNFSe('dps-1', {});
      expect(r.numero_nfse).toBe('35');
      expect(r.chave_acesso).toBe('NFS35000000000000000000000000000000000000000000000');
      expect(r.caminho_danfse).toBe('/nfse/danfse.pdf');
      expect(r.caminho_xml_nota_fiscal).toBe('/nfse/nota.xml');
    });

    it('aceita os apelidos da convenção da NF-e (numero/chave/caminho_danfe)', async () => {
      await build({
        post: { status: 'autorizado', numero: '36', chave: 'CHAVE-ALT', caminho_danfe: '/alt.pdf', caminho_xml: '/alt.xml' },
      });
      const r = await client.emitNFSe('dps-1', {});
      expect(r.numero_nfse).toBe('36');
      expect(r.chave_acesso).toBe('CHAVE-ALT');
      expect(r.caminho_danfse).toBe('/alt.pdf');
      expect(r.caminho_xml_nota_fiscal).toBe('/alt.xml');
    });

    it('resposta sem os campos não vira string "undefined" nem quebra', async () => {
      await build({ post: { status: 'processando_autorizacao' } });
      const r = await client.emitNFSe('dps-1', {});
      expect(r.status).toBe('processando_autorizacao');
      expect(r.numero_nfse).toBeUndefined();
      expect(r.chave_acesso).toBeUndefined();
    });
  });

  // Contrato do port: falha de comunicação NÃO lança, resolve com status 'erro'
  it('erro de comunicação vira status "erro" em vez de exceção', async () => {
    await build();
    http.post.mockReturnValue(throwError(() => ({ message: 'ECONNRESET', response: { status: 500, data: {} } })));
    const r = await client.emitNFSe('dps-1', {});
    expect(r.status).toBe('erro');
    expect(r.motivo).toBeTruthy();
  });
});
