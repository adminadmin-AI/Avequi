import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { SupportController } from './support.controller';

const SECRET = 'triage-secret-xyz';
const DTO = {
  probableCause: 'null deref',
  files: [{ path: 'sales.service.ts', line: 167, reason: 'picking após exit' }],
  module: 'sales',
  severity: 'P1',
  isDuplicateOf: null,
  confidence: 0.82,
  suggestedFix: null,
  safeSelfServiceStep: null,
  needsHuman: false,
} as any;

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('SupportController — write-back assinado (#768)', () => {
  let controller: SupportController;
  let support: { applyDiagnosis: jest.Mock };
  let github: { commentDiagnosis: jest.Mock };
  let env: Record<string, string | undefined>;

  const rawBody = Buffer.from(JSON.stringify(DTO));
  const req = () => ({ rawBody }) as any;

  beforeEach(() => {
    env = { SUPPORT_TRIAGE_HMAC_SECRET: SECRET };
    support = {
      applyDiagnosis: jest
        .fn()
        .mockResolvedValue({ id: 'inc1', protocol: 'AVQ-000042', githubIssueNumber: 7 }),
    };
    github = { commentDiagnosis: jest.fn().mockResolvedValue(true) };
    controller = new SupportController(
      support as any,
      { get: (k: string) => env[k] } as any,
      github as any,
    );
  });

  it('HMAC válido: grava diagnóstico e comenta na issue', async () => {
    const res = await controller.updateDiagnosis(req(), 'inc1', DTO, sign(rawBody));
    expect(support.applyDiagnosis).toHaveBeenCalledWith('inc1', DTO);
    expect(github.commentDiagnosis).toHaveBeenCalledWith(7, DTO);
    expect(res).toEqual({ ok: true, protocol: 'AVQ-000042' });
  });

  it('sem githubIssueNumber: grava mas NÃO comenta', async () => {
    support.applyDiagnosis.mockResolvedValueOnce({
      id: 'inc1',
      protocol: 'AVQ-000042',
      githubIssueNumber: null,
    });
    await controller.updateDiagnosis(req(), 'inc1', DTO, sign(rawBody));
    expect(github.commentDiagnosis).not.toHaveBeenCalled();
  });

  it('HMAC inválido → 401, não grava', async () => {
    await expect(
      controller.updateDiagnosis(req(), 'inc1', DTO, sign(rawBody, 'errado')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(support.applyDiagnosis).not.toHaveBeenCalled();
  });

  it('assinatura ausente → 401', async () => {
    await expect(
      controller.updateDiagnosis(req(), 'inc1', DTO, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(support.applyDiagnosis).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: sem secret configurado, rejeita mesmo com assinatura', async () => {
    env = {};
    await expect(
      controller.updateDiagnosis(req(), 'inc1', DTO, sign(rawBody)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(support.applyDiagnosis).not.toHaveBeenCalled();
  });
});
