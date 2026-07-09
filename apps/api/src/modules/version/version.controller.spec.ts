import { VersionController } from './version.controller';
// A versão esperada É a do package.json — mesma fonte do controller. Antes era
// chumbada e TODO release quebrava o teste (v1.1.0 → alinhado; v1.3.0 → CI
// vermelho no PR de release). Comparar com a fonte mata a recorrência sem
// perder a garantia (name/gitSha/builtAt seguem estritos).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../package.json');

describe('VersionController', () => {
  it('expõe versão do produto + metadados de build', () => {
    const r = new VersionController().version();

    expect(r.name).toBe('avequi-erp-api');
    // version vem do apps/api/package.json (cwd nos testes) — mesma fonte
    expect(r.version).toBe(pkg.version);
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/); // SemVer sano
    // sem build-info.json estampado em teste → fallback "unknown"
    expect(r.gitSha).toBe('unknown');
    expect(r.builtAt).toBe('unknown');
    expect(r).toHaveProperty('env');
  });
});
