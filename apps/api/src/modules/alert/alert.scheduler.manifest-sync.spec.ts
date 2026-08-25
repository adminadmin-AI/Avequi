import { AlertScheduler } from './alert.scheduler';

/**
 * Focus-A (#608): o cron de sync de NF-e recebidas respeita o gate por company
 * (default OFF) e isola falhas: uma company que falha não impede as demais.
 */
describe('AlertScheduler.syncManifests — gate por company + isolamento de falha', () => {
  function build(companies: string[], manifestService: any) {
    const prisma = { company: { findMany: jest.fn().mockResolvedValue(companies.map((id) => ({ id }))) } };
    const scheduler = Object.create(AlertScheduler.prototype) as AlertScheduler;
    Object.assign(scheduler, { prisma, manifestService, logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } });
    return scheduler;
  }

  it('companies desabilitadas são puladas em silêncio: sem sync, sem FAILED, sem log de erro', async () => {
    const manifestService = {
      isSyncEnabled: jest.fn(async (id: string) => id === 'crd'),
      syncReceivedNfes: jest.fn().mockResolvedValue({ synced: 2, updated: 0 }),
    };
    const s = build(['avecchi', 'crd', 'gdr', 'guarapuava', 'usinagem'], manifestService);
    await s.syncManifests();
    expect(manifestService.isSyncEnabled).toHaveBeenCalledTimes(5);
    expect(manifestService.syncReceivedNfes).toHaveBeenCalledTimes(1);
    expect(manifestService.syncReceivedNfes).toHaveBeenCalledWith('crd');
    expect((s as any).logger.error).not.toHaveBeenCalled();
  });

  it('falha de uma company habilitada não impede a sincronização das demais', async () => {
    const manifestService = {
      isSyncEnabled: jest.fn().mockResolvedValue(true),
      syncReceivedNfes: jest.fn(async (id: string) => {
        if (id === 'gdr') throw new Error('Focus nfes_recebidas cnpj=46247069000115 versao=0: HTTP 400 CNPJ não autorizado');
        return { synced: 0, updated: 0 };
      }),
    };
    const s = build(['crd', 'gdr', 'guarapuava'], manifestService);
    await expect(s.syncManifests()).resolves.toBeUndefined();
    expect(manifestService.syncReceivedNfes).toHaveBeenCalledTimes(3);
    expect((s as any).logger.error).toHaveBeenCalledTimes(1);
    expect((s as any).logger.error.mock.calls[0][0]).toContain('gdr');
  });
});
