import { existsSync, readFileSync } from 'fs';

/**
 * #948-C1 — a prova de que os portões redundantes do enum saíram e não voltam.
 *
 * A C1 é a única filha da #948 que não muda regra de negócio nenhuma: ela
 * apaga controle de acesso DUPLICADO. Cada ponto removido já tinha um
 * equivalente em RBAC v2 exigido na própria rota, e o duplicado era sempre
 * MAIS restritivo — barrava, pelo enum congelado, perfis v2 legítimos.
 *
 * Por serem remoções, o risco não é regressão: é reintrodução silenciosa.
 * Daí estes testes serem de código-fonte.
 */
describe('#948-C1 — portões redundantes do enum removidos', () => {
  const ler = (p: string) => readFileSync(`src/${p}`, 'utf-8');

  /**
   * Lê o arquivo SEM comentários.
   *
   * Sem isto, a própria explicação de que o portão foi removido — que cita o
   * nome do array e os enums antigos — faria a guarda acusar reintrodução.
   * O que interessa é o que EXECUTA.
   */
  const lerCodigo = (p: string) =>
    ler(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('RolesGuard não existe mais como arquivo', () => {
    expect(existsSync('src/common/guards/roles.guard.ts')).toBe(false);
    expect(existsSync('src/common/guards/roles.guard.spec.ts')).toBe(false);
  });

  it('RolesGuard não está mais registrado como APP_GUARD', () => {
    // Era um guard global que liberava tudo: nenhuma rota carregava @Roles.
    // Registrado e inerte é pior que ausente — dá falsa sensação de portão.
    const app = ler('app.module.ts');
    expect(app).not.toMatch(/useClass:\s*RolesGuard/);
    expect(app).not.toMatch(/from '\.\/common\/guards\/roles\.guard'/);
  });

  it('ShadowModeService não existe mais e saiu do módulo IAM', () => {
    // Era a comparação legado × v2 da fase de migração (#340). O v2 virou a
    // fonte de verdade no #946: não há mais o que comparar.
    expect(existsSync('src/modules/iam/shadow-mode.service.ts')).toBe(false);
    expect(existsSync('src/modules/iam/shadow-mode.service.spec.ts')).toBe(false);
    expect(ler('modules/iam/iam.module.ts')).not.toMatch(/ShadowModeService/);
  });

  it('o decorator @Roles sobrevive apenas como chave de detecção, marcado como inerte', () => {
    // ROLES_KEY é lido pelo route-gate-coverage e pelos *.access.spec para
    // PROVAR que o enum não gateia rota nenhuma. Apagar o arquivo cegaria
    // essa verificação — o oposto do que a C1 quer.
    const dec = ler('common/decorators/roles.decorator.ts');
    expect(dec).toMatch(/ROLES_KEY/);
    expect(dec).toMatch(/INERTE|@deprecated/);
  });

  it('o gate por enum saiu de Purchase e de Approval', () => {
    expect(lerCodigo('modules/purchase/purchase.service.ts')).not.toMatch(/APPROVER_ROLES/);
    expect(lerCodigo('modules/approval/approval.service.ts')).not.toMatch(
      /\['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'\]/,
    );
  });

  it('as permissões que passam a mandar continuam exigidas nas rotas', () => {
    // A remoção só é segura porque o portão v2 já existia. Se alguém tirar a
    // permissão da rota, isto falha — e o endpoint ficaria sem gate nenhum.
    expect(ler('modules/purchase/purchase.controller.ts')).toMatch(
      /@RequirePermission\('purchases\.orders\.approve'\)/,
    );
    expect(ler('modules/approval/approval.controller.ts')).toMatch(
      /@RequirePermission\('approvals\.requests\.approve'\)/,
    );
  });

  it('o fallback legado do #946 NÃO foi tocado — isso é Fase D', () => {
    // A C1 remove portões redundantes, não a rede de compatibilidade. Quem
    // não tem nada no v2 continua resolvendo pelo espelho do enum.
    const permission = ler('modules/iam/permission.service.ts');
    expect(permission).toMatch(/resolveWithLegacyFallback/);
    expect(existsSync('src/modules/iam/legacy-role-mirror.service.ts')).toBe(true);
  });
});
