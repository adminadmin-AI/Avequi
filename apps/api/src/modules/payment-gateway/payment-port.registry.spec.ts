import { PaymentGateway } from '@prisma/client';
import { GetnetAdapter } from './adapters/getnet.adapter';
import { InfinitePayAdapter } from './adapters/infinitepay.adapter';
import { MockPaymentAdapter } from './adapters/mock.adapter';
import { PaymentPortRegistry } from './payment-port.registry';

describe('PaymentPortRegistry (#596 multi-adquirente)', () => {
  const mock = new MockPaymentAdapter();
  const infinitepay = new InfinitePayAdapter();
  const getnet = new GetnetAdapter();
  const registry = new PaymentPortRegistry(mock, infinitepay, getnet);
  const oldEnv = process.env.PAYMENT_PORT;

  afterEach(() => {
    if (oldEnv === undefined) delete process.env.PAYMENT_PORT;
    else process.env.PAYMENT_PORT = oldEnv;
  });

  it('resolve por gateway da adquirente', () => {
    expect(registry.resolve(PaymentGateway.MOCK)).toBe(mock);
    expect(registry.resolve(PaymentGateway.INFINITEPAY)).toBe(infinitepay);
    expect(registry.resolve(PaymentGateway.GETNET)).toBe(getnet);
  });

  it('sem gateway → default do ambiente (PAYMENT_PORT)', () => {
    process.env.PAYMENT_PORT = 'getnet';
    expect(registry.resolve(undefined)).toBe(getnet);
    expect(registry.resolve(null)).toBe(getnet);
  });

  it('PAYMENT_PORT ausente ou desconhecido → mock (nunca lança)', () => {
    delete process.env.PAYMENT_PORT;
    expect(registry.envDefault()).toBe(mock);
    process.env.PAYMENT_PORT = 'stone';
    expect(registry.envDefault()).toBe(mock);
  });

  it('gatewayOf devolve o enum do adapter (persistido em authGateway)', () => {
    expect(registry.gatewayOf(getnet)).toBe(PaymentGateway.GETNET);
    expect(registry.gatewayOf(infinitepay)).toBe(PaymentGateway.INFINITEPAY);
    expect(registry.gatewayOf(mock)).toBe(PaymentGateway.MOCK);
  });
});
