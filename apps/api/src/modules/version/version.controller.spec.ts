import { VersionController } from './version.controller';

describe('VersionController', () => {
  it('expõe versão do produto + metadados de build', () => {
    const r = new VersionController().version();

    expect(r.name).toBe('avequi-erp-api');
    // version vem do apps/api/package.json (cwd nos testes) — alinhada em 1.0.0
    expect(r.version).toBe('1.0.0');
    // sem build-info.json estampado em teste → fallback "unknown"
    expect(r.gitSha).toBe('unknown');
    expect(r.builtAt).toBe('unknown');
    expect(r).toHaveProperty('env');
  });
});
