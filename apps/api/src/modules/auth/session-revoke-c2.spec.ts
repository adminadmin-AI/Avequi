import { NotFoundException } from '@nestjs/common';
import { AuthController, SESSION_REVOKE_ANY_PERMISSION } from './auth.controller';

/**
 * #1001-C2 — revogação de sessão de terceiros por PERMISSÃO, com escopo.
 *
 * Antes: `if (user.role === 'SUPER_ADMIN')` liberava revogar a sessão de
 * QUALQUER usuário — inclusive de outra empresa, porque o service nunca
 * comparava o `companyId` da sessão com o de quem revogava.
 *
 * Agora quem pode é quem tem `iam.sessions.revoke-any`, e o alcance é o
 * escopo empresarial resolvido pelo TenantScopeService (#947): a própria
 * empresa para quem não tem a capability de grupo (ADMIN_EMPRESA), raiz +
 * filiais para quem tem (ADMIN_GLOBAL).
 */
describe('AuthController.revokeSession — #1001-C2', () => {
  let controller: AuthController;
  let sessionService: { revokeSession: jest.Mock };
  let permissions: { hasAnyPermission: jest.Mock };
  let tenantScope: { resolverEscopo: jest.Mock };

  const ADMIN = { id: 'admin-1', role: 'SUPER_ADMIN', companyId: 'c1' };
  const COMUM = { id: 'user-1', role: 'COMMERCIAL', companyId: 'c1' };

  const podeRevogar = (pode: boolean) => permissions.hasAnyPermission.mockResolvedValue(pode);

  beforeEach(() => {
    sessionService = { revokeSession: jest.fn().mockResolvedValue(undefined) };
    permissions = { hasAnyPermission: jest.fn().mockResolvedValue(false) };
    tenantScope = {
      resolverEscopo: jest.fn().mockResolvedValue({ companyIds: ['c1'], ampliado: false }),
    };

    controller = new AuthController(
      {} as never,
      sessionService as never,
      {} as never,
      {} as never,
      permissions as never,
      tenantScope as never,
    );
  });

  describe('SEM a permissão', () => {
    it('revoga apenas a própria sessão — o dono esperado é ele mesmo', async () => {
      podeRevogar(false);
      await controller.revokeSession(COMUM, 'sess-1');

      expect(sessionService.revokeSession).toHaveBeenCalledWith(
        'sess-1',
        'LOGOUT',
        COMUM.id, // expectedUserId = dono → mismatch vira 404
        expect.objectContaining({ actorUserId: COMUM.id }),
      );
    });

    it('não recebe escopo ampliado — nem consulta o TenantScope', async () => {
      podeRevogar(false);
      await controller.revokeSession(COMUM, 'sess-1');

      expect(tenantScope.resolverEscopo).not.toHaveBeenCalled();
      expect(sessionService.revokeSession).toHaveBeenCalledWith(
        'sess-1',
        'LOGOUT',
        COMUM.id,
        expect.not.objectContaining({ allowedCompanyIds: expect.anything() }),
      );
    });

    it('o ENUM SUPER_ADMIN sozinho NÃO concede o poder', async () => {
      // A prova de que o enum saiu: mesmo usuário com role SUPER_ADMIN, sem a
      // permissão no v2, cai no caminho do dono.
      podeRevogar(false);
      await controller.revokeSession(ADMIN, 'sess-de-outro');

      expect(sessionService.revokeSession).toHaveBeenCalledWith(
        'sess-de-outro',
        'LOGOUT',
        ADMIN.id,
        expect.anything(),
      );
    });
  });

  describe('COM a permissão', () => {
    it('revoga sessão de terceiro, sem exigir dono, com motivo ADMIN_REVOKE', async () => {
      podeRevogar(true);
      await controller.revokeSession(ADMIN, 'sess-de-outro');

      expect(sessionService.revokeSession).toHaveBeenCalledWith(
        'sess-de-outro',
        'ADMIN_REVOKE',
        undefined, // sem dono esperado: é revogação administrativa
        expect.objectContaining({ actorUserId: ADMIN.id, allowedCompanyIds: ['c1'] }),
      );
    });

    it('o alcance é o escopo do TenantScope — ADMIN_GLOBAL enxerga o grupo', async () => {
      podeRevogar(true);
      tenantScope.resolverEscopo.mockResolvedValue({
        companyIds: ['raiz', 'filial-a', 'filial-b'],
        ampliado: true,
      });

      await controller.revokeSession(ADMIN, 'sess-x');

      expect(sessionService.revokeSession).toHaveBeenCalledWith(
        'sess-x',
        'ADMIN_REVOKE',
        undefined,
        expect.objectContaining({ allowedCompanyIds: ['raiz', 'filial-a', 'filial-b'] }),
      );
    });

    it('ADMIN_EMPRESA não atravessa tenant: escopo fica na própria empresa', async () => {
      podeRevogar(true);
      // Sem a capability de grupo (#947), resolverEscopo devolve só a empresa.
      tenantScope.resolverEscopo.mockResolvedValue({ companyIds: ['c1'], ampliado: false });

      await controller.revokeSession({ ...ADMIN, role: 'DIRECTOR' }, 'sess-de-outro-tenant');

      expect(sessionService.revokeSession).toHaveBeenCalledWith(
        'sess-de-outro-tenant',
        'ADMIN_REVOKE',
        undefined,
        expect.objectContaining({ allowedCompanyIds: ['c1'] }),
      );
    });

    it('sessão fora do escopo: o 404 do service propaga sem vazar existência', async () => {
      podeRevogar(true);
      sessionService.revokeSession.mockRejectedValue(
        new NotFoundException('Sessão não encontrada'),
      );

      await expect(controller.revokeSession(ADMIN, 'sess-de-outra-empresa')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('a permissão é resolvida para o usuário e a empresa do JWT', async () => {
      podeRevogar(true);
      await controller.revokeSession(ADMIN, 'sess-1');

      expect(permissions.hasAnyPermission).toHaveBeenCalledWith(ADMIN.id, ADMIN.companyId, [
        SESSION_REVOKE_ANY_PERMISSION,
      ]);
    });

    it('falha na resolução da permissão PROPAGA — não vira poder administrativo', async () => {
      permissions.hasAnyPermission.mockRejectedValue(new Error('redis fora'));

      await expect(controller.revokeSession(ADMIN, 'sess-1')).rejects.toThrow('redis fora');
      expect(sessionService.revokeSession).not.toHaveBeenCalled();
    });
  });
});
