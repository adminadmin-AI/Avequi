-- CreateEnum
CREATE TYPE "SessionRevokedReason" AS ENUM ('LOGOUT', 'EXPIRED', 'ADMIN_REVOKE', 'SECURITY');

-- CreateEnum
CREATE TYPE "LoginFailReason" AS ENUM ('WRONG_PASSWORD', 'INACTIVE', 'LOCKED', 'MFA_FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'CANCEL', 'FINALIZE', 'REOPEN', 'EXPORT', 'IMPORT', 'PRINT', 'EXECUTE', 'PROCESS', 'LOGIN', 'LOGOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'ROLE_CHANGED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'SESSION_REVOKED', 'LOCKOUT', 'ACCOUNT_UNLOCKED', 'MFA_ENABLED', 'MFA_DISABLED', 'TOKEN_REUSE_DETECTED', 'NEW_DEVICE', 'SUSPICIOUS_ACTIVITY');

-- CreateEnum
CREATE TYPE "SecurityEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PermissionChangeType" AS ENUM ('ROLE_ASSIGNED', 'ROLE_REMOVED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED');

-- AlterTable
ALTER TABLE "gdr_users" ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "gdr_permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "scope" JSONB,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_user_role_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_user_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "scope" JSONB,
    "expiresAt" TIMESTAMP(3),
    "grantedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cnpj" TEXT,
    "address" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "managerId" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "leaderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_user_departments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_user_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_user_teams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_user_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "refreshTokenId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceFingerprint" TEXT,
    "city" TEXT,
    "country" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "SessionRevokedReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failReason" "LoginFailReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_trusted_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "name" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "trustedAt" TIMESTAMP(3),
    "trustedBy" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_audit_logs_v2" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" "AuditAction" NOT NULL,
    "module" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_audit_logs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_security_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "eventType" "SecurityEventType" NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL DEFAULT 'INFO',
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_permission_change_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changeType" "PermissionChangeType" NOT NULL,
    "roleId" TEXT,
    "permissionId" TEXT,
    "previousState" JSONB,
    "newState" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_permission_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_permissions_code_key" ON "gdr_permissions"("code");

-- CreateIndex
CREATE INDEX "gdr_permissions_module_idx" ON "gdr_permissions"("module");

-- CreateIndex
CREATE INDEX "gdr_permissions_module_resource_idx" ON "gdr_permissions"("module", "resource");

-- CreateIndex
-- Unicidade de `code` POR empresa/grupo: empresas diferentes podem reutilizar
-- o mesmo code (ex.: "GERENTE_LOJA") sem colisao.
CREATE UNIQUE INDEX "gdr_roles_companyId_code_key" ON "gdr_roles"("companyId", "code");

-- CreateIndex
-- Perfis GLOBAIS/system (companyId IS NULL) precisam de unicidade entre si.
-- Como o indice composto acima trata NULLs como distintos, este indice PARCIAL
-- garante que nao existam dois codes globais iguais.
CREATE UNIQUE INDEX "gdr_roles_code_global_key" ON "gdr_roles"("code") WHERE "companyId" IS NULL;

-- CreateIndex
CREATE INDEX "gdr_roles_companyId_idx" ON "gdr_roles"("companyId");

-- CreateIndex
CREATE INDEX "gdr_role_permissions_permissionId_idx" ON "gdr_role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_role_permissions_roleId_permissionId_key" ON "gdr_role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "gdr_user_role_assignments_userId_idx" ON "gdr_user_role_assignments"("userId");

-- CreateIndex
CREATE INDEX "gdr_user_role_assignments_roleId_idx" ON "gdr_user_role_assignments"("roleId");

-- CreateIndex
CREATE INDEX "gdr_user_role_assignments_companyId_idx" ON "gdr_user_role_assignments"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_role_assignments_userId_roleId_companyId_key" ON "gdr_user_role_assignments"("userId", "roleId", "companyId");

-- CreateIndex
CREATE INDEX "gdr_user_permissions_userId_idx" ON "gdr_user_permissions"("userId");

-- CreateIndex
CREATE INDEX "gdr_user_permissions_companyId_idx" ON "gdr_user_permissions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_permissions_userId_permissionId_companyId_key" ON "gdr_user_permissions"("userId", "permissionId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_branches_companyId_code_key" ON "gdr_branches"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_departments_companyId_code_key" ON "gdr_departments"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_departments_userId_departmentId_key" ON "gdr_user_departments"("userId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_teams_userId_teamId_key" ON "gdr_user_teams"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_sessions_refreshTokenId_key" ON "gdr_user_sessions"("refreshTokenId");

-- CreateIndex
CREATE INDEX "gdr_user_sessions_userId_revokedAt_idx" ON "gdr_user_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "gdr_user_sessions_companyId_idx" ON "gdr_user_sessions"("companyId");

-- CreateIndex
CREATE INDEX "gdr_user_sessions_deviceFingerprint_idx" ON "gdr_user_sessions"("deviceFingerprint");

-- CreateIndex
CREATE INDEX "gdr_login_attempts_email_createdAt_idx" ON "gdr_login_attempts"("email", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_login_attempts_ipAddress_createdAt_idx" ON "gdr_login_attempts"("ipAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_trusted_devices_userId_fingerprint_key" ON "gdr_trusted_devices"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "gdr_audit_logs_v2_companyId_entity_entityId_idx" ON "gdr_audit_logs_v2"("companyId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "gdr_audit_logs_v2_companyId_createdAt_idx" ON "gdr_audit_logs_v2"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_audit_logs_v2_userId_createdAt_idx" ON "gdr_audit_logs_v2"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_audit_logs_v2_requestId_idx" ON "gdr_audit_logs_v2"("requestId");

-- CreateIndex
CREATE INDEX "gdr_security_events_companyId_createdAt_idx" ON "gdr_security_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_security_events_userId_createdAt_idx" ON "gdr_security_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_security_events_eventType_createdAt_idx" ON "gdr_security_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_permission_change_logs_companyId_createdAt_idx" ON "gdr_permission_change_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "gdr_permission_change_logs_targetUserId_createdAt_idx" ON "gdr_permission_change_logs"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "gdr_roles" ADD CONSTRAINT "gdr_roles_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "gdr_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_roles" ADD CONSTRAINT "gdr_roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_role_permissions" ADD CONSTRAINT "gdr_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "gdr_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_role_permissions" ADD CONSTRAINT "gdr_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "gdr_permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_role_assignments" ADD CONSTRAINT "gdr_user_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_role_assignments" ADD CONSTRAINT "gdr_user_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "gdr_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_role_assignments" ADD CONSTRAINT "gdr_user_role_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_role_assignments" ADD CONSTRAINT "gdr_user_role_assignments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "gdr_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_permissions" ADD CONSTRAINT "gdr_user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_permissions" ADD CONSTRAINT "gdr_user_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "gdr_permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_permissions" ADD CONSTRAINT "gdr_user_permissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_branches" ADD CONSTRAINT "gdr_branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_departments" ADD CONSTRAINT "gdr_departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_departments" ADD CONSTRAINT "gdr_departments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_departments" ADD CONSTRAINT "gdr_departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "gdr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_teams" ADD CONSTRAINT "gdr_teams_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "gdr_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_teams" ADD CONSTRAINT "gdr_teams_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_departments" ADD CONSTRAINT "gdr_user_departments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_departments" ADD CONSTRAINT "gdr_user_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "gdr_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_teams" ADD CONSTRAINT "gdr_user_teams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_teams" ADD CONSTRAINT "gdr_user_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "gdr_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_sessions" ADD CONSTRAINT "gdr_user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_sessions" ADD CONSTRAINT "gdr_user_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_user_sessions" ADD CONSTRAINT "gdr_user_sessions_refreshTokenId_fkey" FOREIGN KEY ("refreshTokenId") REFERENCES "gdr_refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_trusted_devices" ADD CONSTRAINT "gdr_trusted_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_audit_logs_v2" ADD CONSTRAINT "gdr_audit_logs_v2_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_audit_logs_v2" ADD CONSTRAINT "gdr_audit_logs_v2_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_audit_logs_v2" ADD CONSTRAINT "gdr_audit_logs_v2_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "gdr_user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_security_events" ADD CONSTRAINT "gdr_security_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_security_events" ADD CONSTRAINT "gdr_security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_permission_change_logs" ADD CONSTRAINT "gdr_permission_change_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_permission_change_logs" ADD CONSTRAINT "gdr_permission_change_logs_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "gdr_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_permission_change_logs" ADD CONSTRAINT "gdr_permission_change_logs_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "gdr_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_permission_change_logs" ADD CONSTRAINT "gdr_permission_change_logs_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "gdr_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_permission_change_logs" ADD CONSTRAINT "gdr_permission_change_logs_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "gdr_permissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

