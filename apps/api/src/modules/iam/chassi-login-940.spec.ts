import { readFileSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS_CATALOG } from './permissions.catalog';
import { resolveEffectivePermissions, SYSTEM_ROLES } from './roles.catalog';
import { DEFAULT_PASSWORD_POLICY } from './password-policy.service';

/**
 * CHASSI LOGIN Fase 1 (#940 / épico #939) — trava a matriz de acesso da
 * ferramenta OpenClaw e o espelho SQL da política de senha.
 *
 * O login da marcadora NÃO passa pela API: a função gdr_chassi_autenticar()
 * (SECURITY DEFINER, migration 20260807190000) resolve as permissões
 * production.chassi.* direto no banco. Estes testes garantem que:
 * 1. o catálogo tem os 4 codes e o seed vai distribuí-los como o Rafael decidiu;
 * 2. a política de senha em SQL nunca fica MAIS FRACA que a do ERP
 *    (password-policy.service.ts) — se alguém endurecer o TS, este teste
 *    quebra e aponta a função SQL para acompanhar.
 */

const MARK = 'production.chassi.mark';
const SPECIAL = 'production.chassi.mark-special';
const FREE = 'production.chassi.mark-free';
const VIEW = 'production.chassi.view';

const efetivas = (code: string) => new Set(resolveEffectivePermissions(code));

describe('CHASSI LOGIN #940 — catálogo e matriz de acesso da marcadora', () => {
  it('os 4 codes production.chassi.* existem no catálogo', () => {
    const codes = new Set(PERMISSIONS_CATALOG.map((p) => p.code));
    for (const c of [VIEW, MARK, SPECIAL, FREE]) {
      expect(codes.has(c)).toBe(true);
    }
  });

  it('operador e supervisor de produção ENTRAM na ferramenta (view+mark), sem os modos de gerente', () => {
    for (const perfil of ['OPERADOR_PRODUCAO', 'SUPERVISOR_PRODUCAO']) {
      const p = efetivas(perfil);
      expect(p.has(VIEW)).toBe(true);
      expect(p.has(MARK)).toBe(true);
      expect(p.has(SPECIAL)).toBe(false);
      expect(p.has(FREE)).toBe(false);
    }
  });

  it('gerência industrial e admins recebem o pacote completo (inclui Modelo Especial e gravação livre)', () => {
    for (const perfil of ['GERENTE_INDUSTRIAL', 'ADMIN_GLOBAL', 'ADMIN_EMPRESA', 'ADMIN_FILIAL']) {
      const p = efetivas(perfil);
      for (const c of [VIEW, MARK, SPECIAL, FREE]) {
        expect({ perfil, code: c, tem: p.has(c) }).toEqual({ perfil, code: c, tem: true });
      }
    }
  });

  it('nenhum outro perfil ganha mark/mark-special/mark-free (a entrada da ferramenta é restrita)', () => {
    const autorizados = new Set([
      'OPERADOR_PRODUCAO', 'SUPERVISOR_PRODUCAO', 'GERENTE_INDUSTRIAL',
      'ADMIN_GLOBAL', 'ADMIN_EMPRESA', 'ADMIN_FILIAL',
    ]);
    for (const role of SYSTEM_ROLES) {
      if (autorizados.has(role.code)) continue;
      const p = efetivas(role.code);
      const vazadas = [MARK, SPECIAL, FREE].filter((c) => p.has(c));
      expect({ perfil: role.code, vazadas }).toEqual({ perfil: role.code, vazadas: [] });
    }
  });
});

describe('CHASSI LOGIN #940 — espelho SQL da política de senha', () => {
  const sql = readFileSync(
    join(__dirname, '../../../prisma/migrations/20260807190000_chassi_login_auth/migration.sql'),
    'utf-8',
  );

  it('a função SQL aplica o mesmo mínimo/máximo de comprimento do ERP', () => {
    // Se DEFAULT_PASSWORD_POLICY endurecer, estes literais precisam acompanhar
    // na função gdr_chassi_trocar_senha() — o teste quebra de propósito.
    expect(sql).toContain(`length(p_senha_nova) < ${DEFAULT_PASSWORD_POLICY.minLength}`);
    expect(sql).toContain(`length(p_senha_nova) > ${DEFAULT_PASSWORD_POLICY.maxLength}`);
  });

  it('a função SQL exige as 4 classes de caractere que o ERP exige', () => {
    expect(DEFAULT_PASSWORD_POLICY.requireUppercase).toBe(true);
    expect(sql).toContain("p_senha_nova !~ '[A-Z]'");
    expect(DEFAULT_PASSWORD_POLICY.requireLowercase).toBe(true);
    expect(sql).toContain("p_senha_nova !~ '[a-z]'");
    expect(DEFAULT_PASSWORD_POLICY.requireDigit).toBe(true);
    expect(sql).toContain("p_senha_nova !~ '[0-9]'");
    expect(DEFAULT_PASSWORD_POLICY.requireSpecial).toBe(true);
    expect(sql).toContain("p_senha_nova !~ '[^A-Za-z0-9]'");
  });

  it('a função SQL bloqueia o reuso do mesmo histórico que o ERP bloqueia', () => {
    expect(sql).toContain(`LIMIT ${DEFAULT_PASSWORD_POLICY.historySize}`);
    expect(sql).toContain(`OFFSET ${DEFAULT_PASSWORD_POLICY.historySize}`);
  });

  it('o hash novo nasce no mesmo bcrypt custo 10 do bcryptjs (o ERP web valida a senha)', () => {
    expect(sql).toContain("gen_salt('bf', 10)");
  });

  it('a entrada da ferramenta é a permissão mark, e os grants são só da chassi_tool', () => {
    expect(sql).toContain("'production.chassi.mark' = ANY (v_perms)");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.gdr_chassi_autenticar');
    expect(sql).toContain('TO chassi_tool');
  });
});
