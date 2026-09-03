/**
 * Prova que scripts, runners e documentação ficaram coerentes com o desenho
 * estrutural × demo (Onda 0 — higiene do seed IAM). Lê os arquivos do repo,
 * sem executar nenhum script.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const API_ROOT = join(__dirname, '..', '..', '..');
const REPO_ROOT = join(API_ROOT, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8');

describe('coerência dos scripts e docs dos seeds', () => {
  const pkg = JSON.parse(read(join(API_ROOT, 'package.json')));

  it('package.json: prisma db seed aponta para o estrutural; há db:seed:iam e db:seed:demo', () => {
    expect(pkg.prisma.seed).toMatch(/prisma\/seed\.ts$/);
    expect(pkg.scripts['db:seed']).toBe('prisma db seed');
    expect(pkg.scripts['db:seed:iam']).toMatch(/prisma\/seed-iam\.ts$/);
    expect(pkg.scripts['db:seed:demo']).toMatch(/prisma\/seed-demo\.ts$/);
  });

  it('cada script de seed só instancia o client e chama o runner correspondente', () => {
    const seed = read(join(API_ROOT, 'prisma', 'seed.ts'));
    const iam = read(join(API_ROOT, 'prisma', 'seed-iam.ts'));
    const demo = read(join(API_ROOT, 'prisma', 'seed-demo.ts'));

    expect(seed).toMatch(/runStructuralSeed\(prisma\)/);
    expect(iam).toMatch(/runIamSeed\(prisma\)/);
    expect(demo).toMatch(/runDemoSeed\(prisma\)/);

    // nenhum script chama seed* direto (o guard vive no runner)
    for (const src of [seed, iam, demo]) {
      expect(src).not.toMatch(/seedIam\(/);
      expect(src).not.toMatch(/seedDemo\(/);
      expect(src).not.toMatch(/seedStructural\(/);
      expect(src).not.toMatch(/prisma\.(user|company)\./);
    }
    // sem bypass: o core do demo não é exportado; só o entrypoint seguro
    const demoModule = read(join(API_ROOT, 'prisma', 'seeds', 'demo.seed.ts'));
    expect(demoModule).toMatch(/^async function seedDemoCore\(/m);
    expect(demoModule).not.toMatch(/export (async )?function seedDemoCore/);
    expect(demoModule).toMatch(/export async function seedDemo\(prisma: PrismaClient, env: SeedEnv = process\.env\)/);
    // nenhum comentário/documentação de seed afirma "destino real"
    for (const f of ['seed.ts', 'seed-iam.ts', 'seed-demo.ts', 'seeds/seed-guard.ts', 'seeds/runners.ts', 'seeds/demo.seed.ts']) {
      expect(read(join(API_ROOT, 'prisma', f))).not.toMatch(/destino real/i);
    }
  });

  it('nenhum arquivo de seed contém identidade real (@gdr.com.br / @crd.com.br / GDR Reboques)', () => {
    const files = [
      'seed.ts',
      'seed-iam.ts',
      'seed-demo.ts',
      'seeds/structural.seed.ts',
      'seeds/demo.seed.ts',
      'seeds/cclasstrib.seed.ts',
      'seeds/runners.ts',
      'seeds/user-role-mirror.ts',
    ];
    for (const f of files) {
      const src = read(join(API_ROOT, 'prisma', f));
      expect(src).not.toMatch(/@gdr\.com\.br/i);
      expect(src).not.toMatch(/@crd\.com\.br/i);
      expect(src).not.toMatch(/GDR Reboques/i);
      expect(src).not.toMatch(/name: 'GDR/);
    }
    // demo: nenhum e-mail fora do domínio fictício e nenhuma referência a operação real
    const demo = read(join(API_ROOT, 'prisma', 'seeds', 'demo.seed.ts'));
    const emails = demo.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) {
      expect(e.endsWith('@exemplo.test')).toBe(true);
    }
    expect(demo).not.toMatch(/NF-e real/i);
    expect(demo).not.toMatch(/14236/);
  });

  it('o estrutural não importa o demo e o demo não importa o estrutural', () => {
    const structural = read(join(API_ROOT, 'prisma', 'seeds', 'structural.seed.ts'));
    const demo = read(join(API_ROOT, 'prisma', 'seeds', 'demo.seed.ts'));
    const imports = (src: string) => src.match(/from '[^']+'/g) ?? [];
    expect(imports(structural).join(' ')).not.toMatch(/demo\.seed/);
    expect(imports(demo).join(' ')).not.toMatch(/structural\.seed|iam\.seed|plans\.seed|cclasstrib\.seed/);
    // o demo só compartilha com o IAM a regra de espelhamento (user-role-mirror), nunca o catálogo
    expect(imports(demo).join(' ')).toMatch(/user-role-mirror/);
  });

  it('.env.example documenta os três comandos, o bloqueio do demo e a senha sem default', () => {
    const env = read(join(REPO_ROOT, '.env.example'));
    expect(env).toMatch(/npm run db:seed`/);
    expect(env).toMatch(/npm run db:seed:iam`/);
    expect(env).toMatch(/npm run db:seed:demo`/);
    expect(env).toMatch(/SEED_USER_PASSWORD=""/);
    expect(env).toMatch(/production bloqueiam/);
    expect(env).toMatch(/nunca vale para o demo/i);
    expect(env).toMatch(/ENDPOINT[\s\S]{0,5}APARENTE/i);
    expect(env).toMatch(/loopback/i);
    expect(env).toMatch(/túnel/i);
    expect(env).toMatch(/preflight/i);
    expect(env).toMatch(/NODE_ENV=development \(exato/);
    expect(env).toMatch(/CONFIRM_DEMO_SEED=true/);
    expect(env).toMatch(/# CONFIRM_DEMO_SEED=false/); // presente, mas nunca habilitado por padrão
    expect(env).not.toMatch(/^CONFIRM_DEMO_SEED=true/m);
    expect(env).toMatch(/exigida também para qualquer endpoint remoto/i);
    // nada de afirmação absoluta sobre "destino real" / "sempre" baseada só na URL
    expect(env).not.toMatch(/destino real/i);
    expect(env).not.toMatch(/bloqueado sempre/i);
    expect(env).not.toMatch(/4 usuários de exemplo/);
    expect(env).not.toMatch(/admin\/diretor\/gerente\/loja/);
  });

  it('ONBOARDING ensina db:seed + db:seed:demo para banco local e mantém a regra de usuário nominal', () => {
    const doc = read(join(REPO_ROOT, 'docs', 'ONBOARDING.md'));
    expect(doc).toMatch(/npm run db:seed --workspace=apps\/api/);
    expect(doc).toMatch(/npm run db:seed:demo --workspace=apps\/api/);
    expect(doc).toMatch(/ENDPOINT APARENTE/);
    expect(doc).toMatch(/só loopback/i);
    expect(doc).toMatch(/túnel/i);
    expect(doc).toMatch(/preflight/i);
    expect(doc).toMatch(/CONFIRM_DEMO_SEED=true/);
    expect(doc).toMatch(/ALLOW_PROD_SEED=true/);
    expect(doc).not.toMatch(/destino real/i);
    expect(doc).toMatch(/usuário nominal/);
    expect(doc).not.toMatch(/@gdr\.com\.br/);
  });
});
