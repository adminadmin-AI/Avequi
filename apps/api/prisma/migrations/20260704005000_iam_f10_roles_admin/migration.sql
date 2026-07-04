-- IAM v2 — F7.2 (#352): tela de gestão de perfis e permissões.
-- Migração 100% ADITIVA (regra do projeto: nenhum DROP, nenhum ALTER destrutivo).

-- AlterEnum: eventos de ciclo de vida de PERFIL no PermissionChangeLog.
-- Mudança de acesso em nível de perfil afeta todos os usuários vinculados;
-- nesses eventos targetUserId = autor da ação (o alvo é o perfil, não um usuário).
ALTER TYPE "PermissionChangeType" ADD VALUE 'ROLE_CREATED';
ALTER TYPE "PermissionChangeType" ADD VALUE 'ROLE_UPDATED';
ALTER TYPE "PermissionChangeType" ADD VALUE 'ROLE_DELETED';
ALTER TYPE "PermissionChangeType" ADD VALUE 'ROLE_PERMISSIONS_CHANGED';
