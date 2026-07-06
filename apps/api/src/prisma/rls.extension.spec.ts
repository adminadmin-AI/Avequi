import { createRlsQueryHandler, RlsClientLike } from './rls.extension';
import {
  runInsidePrismaTransaction,
  runWithTenant,
} from '../common/context/tenant-context';

describe('rls.extension — createRlsQueryHandler', () => {
  let client: RlsClientLike;
  let executeRawMock: jest.Mock;
  let transactionMock: jest.Mock;

  beforeEach(() => {
    executeRawMock = jest.fn().mockReturnValue('SET_CONFIG_PROMISE');
    // Simula batch transaction: resolve cada item (promises ou valores)
    transactionMock = jest.fn(async (ops: unknown[]) => Promise.all(ops));
    client = {
      $executeRaw: executeRawMock as any,
      $transaction: transactionMock as any,
    };
  });

  it('sem tenant no contexto: executa a query direto, sem transacao', async () => {
    const handler = createRlsQueryHandler(client);
    const query = jest.fn().mockResolvedValue(['row']);

    const result = await handler({ args: { where: { id: 1 } }, query });

    expect(result).toEqual(['row']);
    expect(query).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('com tenant: envolve a query em batch transaction com set_config parametrizado', async () => {
    const handler = createRlsQueryHandler(client);
    const query = jest.fn().mockResolvedValue(['row-tenant']);

    const result = await runWithTenant('company-42', () =>
      handler({ args: {}, query }),
    );

    // Resultado da query original preservado (segundo item do batch)
    expect(result).toEqual(['row-tenant']);

    // set_config parametrizado via template tag ($executeRaw), sem Unsafe:
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRawMock.mock.calls[0];
    expect(strings.join('?')).toContain(
      "set_config('app.current_company_id', ?, TRUE)",
    );
    expect(values).toEqual(['company-42']);

    // Batch transaction com [set_config, query]
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const ops = transactionMock.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0]).toBe('SET_CONFIG_PROMISE');
  });

  it('companyId nunca e interpolado na string SQL', async () => {
    const handler = createRlsQueryHandler(client);
    const malicious = "x'; DROP TABLE gdr_products; --";

    await runWithTenant(malicious, () =>
      handler({ args: {}, query: jest.fn().mockResolvedValue(null) }),
    );

    const [strings, ...values] = executeRawMock.mock.calls[0];
    // O valor vai como bind parameter, nunca dentro do texto SQL
    expect(strings.join('')).not.toContain(malicious);
    expect(values).toEqual([malicious]);
  });

  it('dentro de transacao ja aberta: passa direto (evita transacao aninhada/deadlock)', async () => {
    const handler = createRlsQueryHandler(client);
    const query = jest.fn().mockResolvedValue('in-tx');

    const result = await runWithTenant('company-1', () =>
      runInsidePrismaTransaction(() => handler({ args: { a: 1 }, query })),
    );

    expect(result).toBe('in-tx');
    expect(query).toHaveBeenCalledWith({ a: 1 });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('propaga erro da query original', async () => {
    const handler = createRlsQueryHandler(client);
    const query = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      runWithTenant('company-1', () => handler({ args: {}, query })),
    ).rejects.toThrow('boom');
  });
});
