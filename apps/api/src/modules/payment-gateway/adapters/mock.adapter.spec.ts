import { PaymentModality } from '@prisma/client';
import { MockPaymentAdapter } from './mock.adapter';

describe('MockPaymentAdapter (#596)', () => {
  const adapter = new MockPaymentAdapter();
  const req = (amount: number) => ({
    amount,
    installments: 1,
    modality: PaymentModality.CREDITO_AVISTA,
    brand: 'VISA',
    orderRef: 'so-1',
    paymentRef: 'sp-1',
  });

  it('autoriza valor normal com authCode/NSU', async () => {
    const r = await adapter.authorize(req(8000));
    expect(r.authorized).toBe(true);
    expect(r.authCode).toMatch(/^\d{6}$/);
    expect(r.nsu).toBeTruthy();
  });

  it('nega valor terminado em .13 (gatilho de teste)', async () => {
    const r = await adapter.authorize(req(100.13));
    expect(r.authorized).toBe(false);
    expect(r.declineReason).toBeTruthy();
  });

  it('nega valor <= 0', async () => {
    expect((await adapter.authorize(req(0))).authorized).toBe(false);
  });
});
