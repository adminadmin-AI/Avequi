import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { FiscalClientService } from './fiscal-client.service';

// #695 — resolução de token por company (multi-emissor: matriz, loja, CRD)
describe('FiscalClientService — token por company (#695)', () => {
  const ENVS: Record<string, string> = {
    FOCUS_NFE_BASE_URL: 'https://homologacao.focusnfe.com.br',
    FOCUS_NFE_TOKEN: 'token-global-matriz',
    FOCUS_NFE_TOKEN__co_guarapuava: 'token-da-loja',
  };

  let client: FiscalClientService;
  let http: { post: jest.Mock; get: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    http = {
      post: jest.fn().mockReturnValue(of({ data: { status: 'autorizado' } })),
      get: jest.fn().mockReturnValue(of({ data: { status: 'autorizado' } })),
      delete: jest.fn().mockReturnValue(of({ data: { status: 'cancelado' } })),
    };
    const module = await Test.createTestingModule({
      providers: [
        FiscalClientService,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: { get: (key: string, dflt = '') => ENVS[key] ?? dflt },
        },
      ],
    }).compile();
    client = module.get(FiscalClientService);
  });

  it('usa o token indexado da company quando existe', async () => {
    await client.emitNFe('ref-1', {}, 'co_guarapuava');
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/v2/nfe?ref=ref-1'),
      {},
      expect.objectContaining({ auth: { username: 'token-da-loja', password: '' } }),
    );
  });

  it('faz fallback pro token global sem env indexada (matriz e legado)', async () => {
    await client.emitNFe('ref-2', {}, 'co_matriz_sem_env');
    expect(http.post).toHaveBeenCalledWith(
      expect.anything(),
      {},
      expect.objectContaining({ auth: { username: 'token-global-matriz', password: '' } }),
    );
  });

  it('sem companyId (compat) usa o token global', async () => {
    await client.cancelNFe('ref-3', 'teste');
    expect(http.delete).toHaveBeenCalledWith(
      expect.stringContaining('/v2/nfe/ref-3'),
      expect.objectContaining({ auth: { username: 'token-global-matriz', password: '' } }),
    );
  });

  it('erro de comunicação segue o contrato brando do port', async () => {
    http.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));
    const res = await client.emitNFe('ref-4', {}, 'co_guarapuava');
    expect(res.status).toBe('erro');
  });
});
