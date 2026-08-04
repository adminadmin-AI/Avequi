import { describe, expect, it } from 'vitest';
import {
  agruparSecret,
  arquivoDeBackupCodes,
  backupCodesEmFalta,
  backupCodesParaClipboard,
  erroExigeMfa,
  resolveMfaError,
} from './mfa';
import { checkRouteAccess } from './nav-config';

describe('agruparSecret (#936) — secret TOTP legível para digitação manual', () => {
  it('quebra em grupos de 4 e normaliza para maiúsculas', () => {
    expect(agruparSecret('jbswy3dpehpk3pxp')).toBe('JBSW Y3DP EHPK 3PXP');
  });

  it('resto menor que 4 vira o último grupo (sem espaço sobrando)', () => {
    expect(agruparSecret('JBSWY3DPEHPK3PXPAB')).toBe('JBSW Y3DP EHPK 3PXP AB');
  });

  it('ignora espaços já existentes e valores ausentes', () => {
    expect(agruparSecret('JBSW Y3DP')).toBe('JBSW Y3DP');
    expect(agruparSecret('')).toBe('');
    expect(agruparSecret(null)).toBe('');
    expect(agruparSecret(undefined)).toBe('');
  });
});

describe('backupCodesEmFalta (#936)', () => {
  it('avisa a partir de 2 restantes (limite = 3)', () => {
    expect(backupCodesEmFalta(0)).toBe(true);
    expect(backupCodesEmFalta(2)).toBe(true);
    expect(backupCodesEmFalta(3)).toBe(false);
    expect(backupCodesEmFalta(10)).toBe(false);
  });
});

describe('arquivoDeBackupCodes (#936) — o .txt precisa se explicar sozinho', () => {
  const codes = ['aaaa-1111', 'bbbb-2222', 'cccc-3333'];
  const geradoEm = new Date(2026, 7, 3, 9, 5); // 03/08/2026 09:05 (hora local)

  it('nome do arquivo carrega a data em ISO', () => {
    const { filename } = arquivoDeBackupCodes(codes, { email: 'a@b.com', geradoEm });
    expect(filename).toBe('avecchi-backup-codes-2026-08-03.txt');
  });

  it('cabeçalho traz conta e data/hora formatadas em pt-BR', () => {
    const { content } = arquivoDeBackupCodes(codes, { email: 'claudio@avecchi.ai', geradoEm });
    expect(content).toContain('Conta: claudio@avecchi.ai');
    expect(content).toContain('Gerados em: 03/08/2026 09:05');
  });

  it('avisa que o código é de uso único e que regenerar invalida a lista', () => {
    const { content } = arquivoDeBackupCodes(codes, { geradoEm });
    expect(content).toContain('UMA única vez');
    expect(content).toContain('invalida TODOS os desta lista');
  });

  it('numera os códigos na ordem recebida', () => {
    const { content } = arquivoDeBackupCodes(codes, { geradoEm });
    expect(content).toContain('1. aaaa-1111');
    expect(content).toContain('2. bbbb-2222');
    expect(content).toContain('3. cccc-3333');
  });

  it('sem e-mail não escreve "undefined" no arquivo', () => {
    const { content } = arquivoDeBackupCodes(codes, { email: null, geradoEm });
    expect(content).toContain('Conta: —');
    expect(content).not.toContain('undefined');
  });

  it('alinha a numeração quando passa de 9 códigos', () => {
    const dez = Array.from({ length: 10 }, (_, i) => `code-${i}`);
    const { content } = arquivoDeBackupCodes(dez, { geradoEm });
    expect(content).toContain(' 1. code-0');
    expect(content).toContain('10. code-9');
  });
});

describe('backupCodesParaClipboard (#936)', () => {
  it('um código por linha', () => {
    expect(backupCodesParaClipboard(['a', 'b'])).toBe('a\nb');
  });
});

describe('resolveMfaError (#936) — o usuário nunca lê "status code 429"', () => {
  const erro = (status: number, message?: unknown) => ({ response: { status, data: { message } } });

  it('429 (throttle 5/min) vira instrução de esperar — mesmo com mensagem do servidor', () => {
    expect(resolveMfaError(erro(429, 'ThrottlerException: Too Many Requests'), 'x')).toBe(
      'Muitas tentativas. Aguarde 1 minuto e tente de novo.',
    );
  });

  it('mensagem do backend passa direto (código inválido, senha inválida, já habilitado)', () => {
    expect(resolveMfaError(erro(401, 'Código TOTP inválido.'), 'x')).toBe('Código TOTP inválido.');
    expect(resolveMfaError(erro(409, 'MFA já está habilitado.'), 'x')).toBe(
      'MFA já está habilitado.',
    );
  });

  it('503 sem mensagem (ENCRYPTION_KEY) explica a indisponibilidade', () => {
    expect(resolveMfaError(erro(503), 'x')).toContain('indisponível no momento');
  });

  it('erro sem resposta (rede/timeout) cai no fallback da tela', () => {
    expect(resolveMfaError(new Error('Network Error'), 'Não foi possível ativar.')).toBe(
      'Não foi possível ativar.',
    );
  });
});

describe('erroExigeMfa (#936) — 403 do OpsMfaGuard é acionável, não definitivo', () => {
  it('reconhece a negativa do portal da operadora', () => {
    expect(
      erroExigeMfa(
        'O portal da operadora exige MFA (verificação em duas etapas) ativo. ' +
          'Habilite o MFA no seu perfil e tente novamente.',
      ),
    ).toBe(true);
  });

  it('403 de permissão comum não vira convite a ativar MFA', () => {
    expect(erroExigeMfa('Você não tem permissão para acessar esta área.')).toBe(false);
    expect(erroExigeMfa(undefined)).toBe(false);
    expect(erroExigeMfa(null)).toBe(false);
  });
});

describe('rota /app/account/security (#936) — autoatendimento, sem gate de módulo', () => {
  /**
   * Mesmo precedente da troca de senha (#736, ver password-change.spec.ts): a
   * rota NÃO entra no NAV de propósito → checkRouteAccess devolve "unmapped"
   * e o RouteGuard libera para qualquer autenticado. Tem de ser assim: quem
   * precisa ativar o MFA para entrar no /ops é justamente quem ainda está
   * sendo barrado, e gate de permissão aqui viraria um beco sem saída.
   * Se alguém mapear a rota com permission/roles, este teste quebra.
   */
  it('não é mapeada no NAV → liberada para qualquer perfil autenticado', () => {
    expect(checkRouteAccess('/app/account/security', { role: 'READER', can: () => false })).toEqual(
      { status: 'unmapped' },
    );
  });
});
