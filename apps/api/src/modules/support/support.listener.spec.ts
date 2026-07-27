import { SupportListener } from './support.listener';

describe('SupportListener — producer da triagem (#768)', () => {
  let listener: SupportListener;
  let support: any;
  let github: { createForIncident: jest.Mock };
  let queue: { add: jest.Mock };

  beforeEach(() => {
    support = { captureAutoError: jest.fn() };
    github = { createForIncident: jest.fn().mockResolvedValue(7) };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    listener = new SupportListener(support, github as any, queue as any);
  });

  it('enfileira a triagem após o fluxo WP3, com attempts e backoff exponencial', async () => {
    await listener.onIncidentCaptured({ incidentId: 'inc1', companyId: 'c1' });
    expect(github.createForIncident).toHaveBeenCalledWith('inc1');
    expect(queue.add).toHaveBeenCalledWith(
      { incidentId: 'inc1' },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });

  it('falha ao criar issue (WP3) NÃO impede o enfileiramento da triagem', async () => {
    github.createForIncident.mockRejectedValueOnce(new Error('GitHub down'));
    await listener.onIncidentCaptured({ incidentId: 'inc1', companyId: 'c1' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('falha ao enfileirar NÃO propaga (segunda camada try/catch)', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      listener.onIncidentCaptured({ incidentId: 'inc1', companyId: 'c1' }),
    ).resolves.toBeUndefined();
  });
});
