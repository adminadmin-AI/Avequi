import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateDiagnosisDto } from './update-diagnosis.dto';

const VALID = {
  probableCause: 'null deref no picking',
  files: [{ path: 'sales.service.ts', line: 167, reason: 'ordem invertida' }],
  module: 'sales',
  severity: 'P1',
  isDuplicateOf: null,
  confidence: 0.8,
  suggestedFix: null,
  safeSelfServiceStep: null,
  needsHuman: false,
};

function errorsFor(overrides: Record<string, unknown>) {
  const dto = plainToInstance(UpdateDiagnosisDto, { ...VALID, ...overrides });
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateDiagnosisDto', () => {
  it('aceita um payload válido', () => {
    expect(errorsFor({})).toHaveLength(0);
  });

  it('rejeita severity fora de P0..P3', () => {
    expect(errorsFor({ severity: 'CRITICAL' }).length).toBeGreaterThan(0);
  });

  it('rejeita confidence > 1', () => {
    expect(errorsFor({ confidence: 1.5 }).length).toBeGreaterThan(0);
  });

  it('rejeita confidence < 0', () => {
    expect(errorsFor({ confidence: -0.1 }).length).toBeGreaterThan(0);
  });

  it('rejeita files com line não-numérica (nested validation)', () => {
    expect(
      errorsFor({ files: [{ path: 'a.ts', line: 'x', reason: 'y' }] }).length,
    ).toBeGreaterThan(0);
  });

  it('rejeita needsHuman não-booleano', () => {
    expect(errorsFor({ needsHuman: 'sim' }).length).toBeGreaterThan(0);
  });
});
