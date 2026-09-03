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
    ];
    for (const f of files) {
      const src = read(join(API_ROOT, 'prisma', f));
      expect(src).not.toMatch(/@gdr\.com\.br/i);
      expect(src).not.toMatch(/@crd\.com\.br/i);
      expect(src).not.toMatch(/GDR Reboques/i);
      expect(src).not.toMatch(/name: 'GDR/);
    }
  });

  it('o estrutural não importa o demo e o demo não importa o estrutural', () => {
    const structural = read(join(API_ROOT, 'prisma', 'seeds', 'structural.seed.ts'));
    const demo = read(join(API_ROOT, 'prisma', 'seeds', 'demo.seed.ts'));
    const imports = (src: string) => src.match(/from '[^']+'/g) ?? [];
    expect(imports(structural).join(' ')).not.toMatch(/demo\.seed/);
    expect(imports(demo).join(' ')).not.toMatch(/structural\.seed|iam\.seed|plans\.seed|cclasstrib\.seed/);
  });

  it('.env.example documenta os três comandos, o bloqueio do demo e a senha sem default', () => {
    const env = read(join(REPO_ROOT, '.env.example'));
    expect(env).toMatch(/npm run db:seed`/);
    expect(env).toMatch(/npm run db:seed:iam`/);
    expect(env).toMatch(/npm run db:seed:demo`/);
    expect(env).toMatch(/SEED_USER_PASSWORD=""/);
    expect(env).toMatch(/BLOQUEADO em NODE_ENV=production/);
    expect(env).toMatch(/nunca vale para o demo/i);
    expect(env).not.toMatch(/4 usuários de exemplo/);
    expect(env).not.toMatch(/admin\/diretor\/gerente\/loja/);
  });

  it('ONBOARDING ensina db:seed + db:seed:demo para banco local e mantém a regra de usuário nominal', () => {
    const doc = read(join(REPO_ROOT, 'docs', 'ONBOARDING.md'));
    expect(doc).toMatch(/npm run db:seed --workspace=apps\/api/);
    expect(doc).toMatch(/npm run db:seed:demo --workspace=apps\/api/);
    expect(doc).toMatch(/NUNCA contra produção/);
    expect(doc).toMatch(/usuário nominal/);
    expect(doc).not.toMatch(/@gdr\.com\.br/);
  });
});
