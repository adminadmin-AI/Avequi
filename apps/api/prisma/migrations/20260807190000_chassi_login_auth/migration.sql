-- ═══════════════════════════════════════════════════════════════════════════
-- CHASSI LOGIN Fase 1 (#940 / épico #939) — autenticação da ferramenta OpenClaw
--
-- A ferramenta da marcadora fala Postgres direto (role de privilégio mínimo
-- `chassi_tool`). O login NÃO passa pela API: acontece dentro do banco, em
-- funções SECURITY DEFINER, para que a ferramenta jamais leia gdr_users nem
-- veja hash de senha — ela recebe só nome + permissões production.chassi.*.
-- Plano completo: scripts/openclaw/PLANO_LOGIN_OPENCLAW.md (projeto_sql_xml).
--
-- ⚠️ POLÍTICA DE SENHA ESPELHADA: gdr_chassi_trocar_senha() reproduz a
-- password-policy.service.ts (10-128 chars, 4 classes, anti-reuso das últimas
-- 5, não conter nome/e-mail). Se a política do ERP endurecer, esta função
-- PRECISA acompanhar — há teste em chassi-login-940.spec.ts travando isso.
-- Divergência consciente: a lista de senhas comuns do TS não é replicada em
-- SQL (defesa em profundidade; as 4 classes barram a maioria da lista).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Rastreabilidade: quem gravou, por FK (o campo texto `operador` continua —
--    histórico não se reescreve; as duas colunas passam a andar juntas) ──────
ALTER TABLE "gdr_chassi_gravacoes" ADD COLUMN IF NOT EXISTS "operador_user_id" TEXT;
ALTER TABLE "gdr_chassi_eventos"   ADD COLUMN IF NOT EXISTS "operador_user_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "gdr_chassi_gravacoes"
    ADD CONSTRAINT "gdr_chassi_gravacoes_operador_user_id_fkey"
    FOREIGN KEY ("operador_user_id") REFERENCES "gdr_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "gdr_chassi_eventos"
    ADD CONSTRAINT "gdr_chassi_eventos_operador_user_id_fkey"
    FOREIGN KEY ("operador_user_id") REFERENCES "gdr_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "gdr_chassi_gravacoes_operador_user_id_idx"
  ON "gdr_chassi_gravacoes"("operador_user_id");

-- ── Função 1: autenticação ──────────────────────────────────────────────────
-- Devolve jsonb { ok, motivo?, user_id?, nome?, email?, must_change_password?,
-- permissoes? }. `motivo` é um código estável para a ferramenta traduzir em
-- mensagem de chão de fábrica. Toda tentativa (sucesso/falha) vai para
-- gdr_login_attempts com userAgent "openclaw:<estacao>" — mesma trilha do ERP.
CREATE OR REPLACE FUNCTION public.gdr_chassi_autenticar(
  p_email text, p_senha text, p_estacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user   record;
  v_agente text := 'openclaw:' || coalesce(nullif(trim(p_estacao), ''), 'estacao-desconhecida');
  v_perms  text[];
BEGIN
  SELECT id, name, email, "passwordHash", "isActive", "lockedUntil",
         "mustChangePassword", "companyId"
    INTO v_user
    FROM gdr_users
   WHERE lower(email) = lower(trim(p_email));

  -- e-mail desconhecido: mesma resposta de senha errada (anti-enumeração)
  IF v_user.id IS NULL THEN
    INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "failReason", "createdAt")
    VALUES (gen_random_uuid()::text, lower(trim(p_email)), v_agente, false, 'WRONG_PASSWORD', now());
    RETURN jsonb_build_object('ok', false, 'motivo', 'credenciais');
  END IF;

  IF NOT v_user."isActive" THEN
    INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "failReason", "createdAt")
    VALUES (gen_random_uuid()::text, v_user.email, v_agente, false, 'INACTIVE', now());
    RETURN jsonb_build_object('ok', false, 'motivo', 'inativo');
  END IF;

  IF v_user."lockedUntil" IS NOT NULL AND v_user."lockedUntil" > now() THEN
    INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "failReason", "createdAt")
    VALUES (gen_random_uuid()::text, v_user.email, v_agente, false, 'LOCKED', now());
    RETURN jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  END IF;

  IF extensions.crypt(p_senha, v_user."passwordHash") <> v_user."passwordHash" THEN
    INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "failReason", "createdAt")
    VALUES (gen_random_uuid()::text, v_user.email, v_agente, false, 'WRONG_PASSWORD', now());
    RETURN jsonb_build_object('ok', false, 'motivo', 'credenciais');
  END IF;

  -- Permissões efetivas production.chassi.* — espelha o PermissionService:
  -- perfis ativos do usuário NA EMPRESA DELE (com herança parentId) +
  -- exceções individuais grant; deny individual vence qualquer grant.
  -- Só o namespace da marcadora sai do banco: menor privilégio no payload.
  WITH RECURSIVE papeis AS (
    SELECT r.id, r."parentId"
      FROM gdr_user_role_assignments a
      JOIN gdr_roles r ON r.id = a."roleId" AND r."isActive"
     WHERE a."userId" = v_user.id
       AND a."companyId" = v_user."companyId"
       AND (a."expiresAt" IS NULL OR a."expiresAt" > now())
    UNION
    SELECT pr.id, pr."parentId"
      FROM gdr_roles pr
      JOIN papeis f ON pr.id = f."parentId"
     WHERE pr."isActive"
  ),
  concedidas AS (
    SELECT p.code
      FROM papeis
      JOIN gdr_role_permissions rp ON rp."roleId" = papeis.id AND rp.granted
      JOIN gdr_permissions p ON p.id = rp."permissionId"
     WHERE p.code LIKE 'production.chassi.%'
    UNION
    SELECT p.code
      FROM gdr_user_permissions up
      JOIN gdr_permissions p ON p.id = up."permissionId"
     WHERE up."userId" = v_user.id
       AND up."companyId" = v_user."companyId"
       AND up.granted
       AND (up."expiresAt" IS NULL OR up."expiresAt" > now())
       AND p.code LIKE 'production.chassi.%'
  )
  SELECT coalesce(array_agg(DISTINCT c.code), '{}')
    INTO v_perms
    FROM concedidas c
   WHERE NOT EXISTS (
     SELECT 1
       FROM gdr_user_permissions d
       JOIN gdr_permissions dp ON dp.id = d."permissionId"
      WHERE d."userId" = v_user.id
        AND d."companyId" = v_user."companyId"
        AND NOT d.granted
        AND (d."expiresAt" IS NULL OR d."expiresAt" > now())
        AND dp.code = c.code
   );

  -- Sem a permissão de entrada, a senha certa NÃO abre a ferramenta.
  -- failReason fica NULO de propósito: o enum LoginFailReason não tem
  -- "sem permissão" e registrar WRONG_PASSWORD seria mentir na trilha.
  IF NOT ('production.chassi.mark' = ANY (v_perms)) THEN
    INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "createdAt")
    VALUES (gen_random_uuid()::text, v_user.email, v_agente, false, now());
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  END IF;

  INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "createdAt")
  VALUES (gen_random_uuid()::text, v_user.email, v_agente, true, now());

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'nome', v_user.name,
    'email', v_user.email,
    'must_change_password', v_user."mustChangePassword",
    'permissoes', to_jsonb(v_perms)
  );
END;
$fn$;

-- ── Função 2: troca de senha (primeiro acesso / voluntária) ─────────────────
-- A ferramenta é uma segunda porta para a MESMA senha de gdr_users: o hash
-- novo nasce em bcrypt custo 10 (mesmo formato do bcryptjs), então o ERP web
-- aceita a senha sem saber que ela veio da marcadora.
CREATE OR REPLACE FUNCTION public.gdr_chassi_trocar_senha(
  p_email text, p_senha_atual text, p_senha_nova text, p_estacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_user      record;
  v_agente    text := 'openclaw:' || coalesce(nullif(trim(p_estacao), ''), 'estacao-desconhecida');
  v_erros     text[] := '{}';
  v_lower     text;
  v_token     text;
  v_hash_novo text;
  v_historico int;
BEGIN
  SELECT id, name, email, "passwordHash", "isActive", "lockedUntil", "companyId"
    INTO v_user
    FROM gdr_users
   WHERE lower(email) = lower(trim(p_email));

  IF v_user.id IS NULL
     OR NOT v_user."isActive"
     OR (v_user."lockedUntil" IS NOT NULL AND v_user."lockedUntil" > now())
     OR extensions.crypt(p_senha_atual, v_user."passwordHash") <> v_user."passwordHash" THEN
    INSERT INTO gdr_login_attempts (id, email, "userAgent", success, "failReason", "createdAt")
    VALUES (gen_random_uuid()::text, lower(trim(p_email)), v_agente, false, 'WRONG_PASSWORD', now());
    RETURN jsonb_build_object('ok', false, 'motivo', 'credenciais');
  END IF;

  -- Complexidade — espelho de password-policy.service.ts (mensagens PT-BR).
  v_lower := lower(p_senha_nova);
  IF length(p_senha_nova) < 10 THEN
    v_erros := array_append(v_erros, 'A senha deve ter no mínimo 10 caracteres.');
  END IF;
  IF length(p_senha_nova) > 128 THEN
    v_erros := array_append(v_erros, 'A senha deve ter no máximo 128 caracteres.');
  END IF;
  IF p_senha_nova !~ '[A-Z]' THEN
    v_erros := array_append(v_erros, 'A senha deve conter pelo menos uma letra maiúscula (A-Z).');
  END IF;
  IF p_senha_nova !~ '[a-z]' THEN
    v_erros := array_append(v_erros, 'A senha deve conter pelo menos uma letra minúscula (a-z).');
  END IF;
  IF p_senha_nova !~ '[0-9]' THEN
    v_erros := array_append(v_erros, 'A senha deve conter pelo menos um número (0-9).');
  END IF;
  IF p_senha_nova !~ '[^A-Za-z0-9]' THEN
    v_erros := array_append(v_erros, 'A senha deve conter pelo menos um caractere especial (ex.: !@#$%&*).');
  END IF;

  -- não conter nome/e-mail (tokens de 3+ chars, como no serviço TS)
  IF v_erros = '{}' THEN
    FOREACH v_token IN ARRAY
      array_prepend(split_part(lower(v_user.email), '@', 1),
                    regexp_split_to_array(lower(v_user.name), '\s+'))
    LOOP
      IF length(v_token) >= 3 AND position(v_token IN v_lower) > 0 THEN
        v_erros := array_append(v_erros, 'A senha não pode conter o seu nome ou o seu e-mail.');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_erros <> '{}' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'politica', 'erros', to_jsonb(v_erros));
  END IF;

  -- anti-reuso: senha atual + últimas 5 do histórico
  IF extensions.crypt(p_senha_nova, v_user."passwordHash") = v_user."passwordHash" THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'reuso',
      'erros', to_jsonb(ARRAY['A nova senha não pode ser igual a nenhuma das últimas 5 senhas utilizadas.']));
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT hash FROM gdr_password_history
       WHERE "userId" = v_user.id
       ORDER BY "createdAt" DESC LIMIT 5
    ) h
    WHERE extensions.crypt(p_senha_nova, h.hash) = h.hash
  ) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'reuso',
      'erros', to_jsonb(ARRAY['A nova senha não pode ser igual a nenhuma das últimas 5 senhas utilizadas.']));
  END IF;

  v_hash_novo := extensions.crypt(p_senha_nova, extensions.gen_salt('bf', 10));

  -- histórico igual ao recordPasswordChange: na 1ª troca o hash ANTERIOR
  -- também entra (a senha provisória passa a contar para o anti-reuso)
  SELECT count(*) INTO v_historico FROM gdr_password_history WHERE "userId" = v_user.id;
  IF v_historico = 0 THEN
    INSERT INTO gdr_password_history (id, "userId", hash, "createdAt")
    VALUES (gen_random_uuid()::text, v_user.id, v_user."passwordHash", now() - interval '1 second');
  END IF;
  INSERT INTO gdr_password_history (id, "userId", hash, "createdAt")
  VALUES (gen_random_uuid()::text, v_user.id, v_hash_novo, now());
  DELETE FROM gdr_password_history
   WHERE id IN (
     SELECT id FROM gdr_password_history
      WHERE "userId" = v_user.id
      ORDER BY "createdAt" DESC OFFSET 5
   );

  UPDATE gdr_users
     SET "passwordHash" = v_hash_novo,
         "mustChangePassword" = false,
         "passwordChangedAt" = now(),
         "updatedAt" = now()
   WHERE id = v_user.id;

  -- auditoria síncrona, mesma trilha do ERP (Decisão 5 da arquitetura IAM)
  INSERT INTO gdr_security_events
    (id, "companyId", "userId", "eventType", severity, metadata, "userAgent", "createdAt")
  VALUES
    (gen_random_uuid()::text, v_user."companyId", v_user.id,
     'PASSWORD_CHANGED', 'INFO',
     jsonb_build_object('origem', 'openclaw', 'estacao', coalesce(p_estacao, '')),
     v_agente, now());

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── Função 3: revalidação de cache offline (revogação) ──────────────────────
-- A estação guarda um cache local de quem já logou (janela offline de 7 dias).
-- Na sincronização, a ferramenta pergunta por esses e-mails: quem estiver
-- inativo/bloqueado/sem a permissão de entrada tem o cache APAGADO na hora —
-- a janela de 7 dias é o teto, não a regra. Não exige senha (não autentica:
-- só confirma se um acesso JÁ concedido continua de pé) e só responde sobre
-- e-mails que a estação já conhece.
CREATE OR REPLACE FUNCTION public.gdr_chassi_revalidar(p_emails text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_email text;
  v_res   jsonb := '{}'::jsonb;
  v_login jsonb;
  v_user  record;
  v_perms text[];
BEGIN
  FOREACH v_email IN ARRAY coalesce(p_emails, '{}') LOOP
    SELECT id, "isActive", "lockedUntil", "companyId"
      INTO v_user
      FROM gdr_users
     WHERE lower(email) = lower(trim(v_email));

    IF v_user.id IS NULL OR NOT v_user."isActive"
       OR (v_user."lockedUntil" IS NOT NULL AND v_user."lockedUntil" > now()) THEN
      v_res := v_res || jsonb_build_object(lower(trim(v_email)), jsonb_build_object('ok', false));
      CONTINUE;
    END IF;

    WITH RECURSIVE papeis AS (
      SELECT r.id, r."parentId"
        FROM gdr_user_role_assignments a
        JOIN gdr_roles r ON r.id = a."roleId" AND r."isActive"
       WHERE a."userId" = v_user.id
         AND a."companyId" = v_user."companyId"
         AND (a."expiresAt" IS NULL OR a."expiresAt" > now())
      UNION
      SELECT pr.id, pr."parentId" FROM gdr_roles pr JOIN papeis f ON pr.id = f."parentId"
       WHERE pr."isActive"
    ),
    concedidas AS (
      SELECT p.code FROM papeis
        JOIN gdr_role_permissions rp ON rp."roleId" = papeis.id AND rp.granted
        JOIN gdr_permissions p ON p.id = rp."permissionId"
       WHERE p.code LIKE 'production.chassi.%'
      UNION
      SELECT p.code FROM gdr_user_permissions up
        JOIN gdr_permissions p ON p.id = up."permissionId"
       WHERE up."userId" = v_user.id AND up."companyId" = v_user."companyId"
         AND up.granted AND (up."expiresAt" IS NULL OR up."expiresAt" > now())
         AND p.code LIKE 'production.chassi.%'
    )
    SELECT coalesce(array_agg(DISTINCT c.code), '{}') INTO v_perms
      FROM concedidas c
     WHERE NOT EXISTS (
       SELECT 1 FROM gdr_user_permissions d
         JOIN gdr_permissions dp ON dp.id = d."permissionId"
        WHERE d."userId" = v_user.id AND d."companyId" = v_user."companyId"
          AND NOT d.granted AND (d."expiresAt" IS NULL OR d."expiresAt" > now())
          AND dp.code = c.code
     );

    IF 'production.chassi.mark' = ANY (v_perms) THEN
      v_login := jsonb_build_object('ok', true, 'permissoes', to_jsonb(v_perms));
    ELSE
      v_login := jsonb_build_object('ok', false);
    END IF;
    v_res := v_res || jsonb_build_object(lower(trim(v_email)), v_login);
  END LOOP;
  RETURN v_res;
END;
$fn$;

-- ── Grants: só a role da ferramenta executa; ninguém mais ───────────────────
-- (DO + verificação de existência: em shadow database / ambientes de dev a
-- role chassi_tool pode não existir e a migration não pode quebrar por isso)
REVOKE ALL ON FUNCTION public.gdr_chassi_autenticar(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdr_chassi_trocar_senha(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gdr_chassi_revalidar(text[]) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chassi_tool') THEN
    GRANT EXECUTE ON FUNCTION public.gdr_chassi_autenticar(text, text, text) TO chassi_tool;
    GRANT EXECUTE ON FUNCTION public.gdr_chassi_trocar_senha(text, text, text, text) TO chassi_tool;
    GRANT EXECUTE ON FUNCTION public.gdr_chassi_revalidar(text[]) TO chassi_tool;
  END IF;
END $$;
