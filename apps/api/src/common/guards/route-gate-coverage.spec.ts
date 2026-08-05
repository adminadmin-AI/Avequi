import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Varredura de cobertura de gate (#353 — "role bypass: endpoint sem guard").
 *
 * Descobre TODOS os controllers de src/modules em runtime (glob + metadata do
 * Nest) e falha se qualquer rota nascer sem classificação explícita:
 * @RequirePermission (RBAC v2), @Roles (enum legado), @Public (allowlist
 * exata abaixo) ou entrada consciente numa das listas de exceção.
 *
 * Foi exatamente esta classe de bug que a migração #341 (blocos A–E) fechou —
 * este teste impede regressão: controller novo sem gate quebra o CI na hora.
 *
 * Como atualizar (SEMPRE decisão consciente, nunca mecânica):
 * - Rota nova de negócio → dê um @RequirePermission (catálogo IAM).
 * - Rota pública nova → precisa de validação própria (token/assinatura) e
 *   entrada no PUBLIC_ALLOWLIST com justificativa.
 * - Migrou um controller pendente → REMOVA-o de PENDING_MIGRATION (o teste
 *   de lista estagnada avisa).
 */

/** Rotas @Public — allowlist EXATA. Toda rota aqui valida a si própria
 *  (webhook com token/assinatura, pré-auth do login, ou é imutável/pública). */
const PUBLIC_ALLOWLIST = [
  'AuthController.login', // pré-auth
  'AuthController.refresh', // rotação de refresh token (valida o token no body)
  'AuthController.passwordPolicyInfo', // tela de login lê a política
  'AuthController.changePassword', // fluxo de senha expirada (exige senha atual)
  'AuthController.verifyMfa', // 2º fator pré-token (valida challenge)
  'ConnectorsController.mlWebhook', // webhook Mercado Livre (validação própria)
  'ConnectorsController.olxLead', // webhook OLX (validação própria)
  'MetaLeadsController.verify', // handshake Meta (hub.challenge)
  'MetaLeadsController.webhook', // webhook Meta (assinatura)
  'SiteLeadController.create', // formulário público do site (rate-limited)
  'WhatsappController.verify', // handshake Meta WhatsApp
  'WhatsappController.webhook', // webhook WhatsApp (assinatura)
  'FiscalController.webhook', // Focus NFe (x-focus-token, timingSafeEqual)
  'SupportController.updateDiagnosis', // write-back triagem (#768, HMAC x-triage-signature, fail-closed)
  'VersionController.version', // GET /version — público por design
  'InviteController.accept', // aceite de convite de tenant (OPS WP2 #909 — token sha256 uso único 72h, throttle 5/min, resposta única p/ token inválido)
].sort();

/** Controllers com migração RBAC v2 PENDENTE — rotas sem gate toleradas até a
 *  issue fechar. Migrou? Remova a entrada (o teste de estagnação cobra). */
const PENDING_MIGRATION: Record<string, string> = {
  // #625 (bloco G) MIGRADO no PR #694; #624 (bloco F — família crm.*)
  // MIGRADO neste PR: CrmController e WhatsappController saíram da lista
  // (gate único @RequirePermission nas 49 rotas autenticadas; os webhooks
  // seguem na PUBLIC_ALLOWLIST acima). A lista está VAZIA: todo controller
  // novo nasce gateado.
};

/** Rotas autenticadas-por-design (self-service do próprio usuário) ou com
 *  autenticação própria fora do JWT — sem permissão de catálogo de propósito. */
const SELF_SERVICE_OK = new Set([
  // AuthController — operações do PRÓPRIO usuário logado
  'AuthController.logout',
  'AuthController.myPermissions',
  'AuthController.mfaStatus', // #936 — estado do MFA do próprio usuário (tela de segurança)
  'AuthController.setupMfa',
  'AuthController.confirmMfa',
  'AuthController.disableMfa',
  'AuthController.regenerateBackupCodes',
  'AuthController.listSessions',
  'AuthController.revokeSession',
  'AuthController.revokeAllSessions',
  'AuthController.listDevices',
  'AuthController.trustDevice',
  // Push notifications — inscrição do próprio dispositivo
  'NotificationController.getPublicKey',
  'NotificationController.listMine',
  'NotificationController.subscribe',
  'NotificationController.unsubscribe',
  // Supplier Portal — autenticação própria por token do portal (não JWT/RBAC)
  'SupplierPortalController.getProfile',
  'SupplierPortalController.getSummary',
  'SupplierPortalController.listPurchaseOrders',
  'SupplierPortalController.getPurchaseOrder',
  'SupplierPortalController.listReceipts',
  'SupplierPortalController.listPayments',
  'SupplierPortalController.listNcrs',
  // Support (#764) — reportar problema e ver os próprios chamados é direito de
  // qualquer usuário logado (self-service); gestão/triagem virá com permissão.
  'SupportController.create',
  'SupportController.listMine',
  // OPS WP4 (#911) — o que a PRÓPRIA conta contratou: qualquer usuário logado
  // lê (a nav esconde módulo não contratado); dados são do tenant dele.
  'EntitlementController.me',
  // OPS WP5 (#912) — status de cobrança da PRÓPRIA conta (banner de
  // inadimplência do app); situação financeira da conta do próprio usuário.
  'BillingStatusController.myStatus',
  // Sidebar (#975) — favoritos/seções recolhidas do PRÓPRIO usuário (escopo
  // por userId do JWT); preferência pessoal de UI, sem permissão de catálogo.
  'UserController.getUiPreferences',
  'UserController.saveUiPreferences',
]);

interface Route {
  id: string; // Controller.handler
  controller: string;
  isPublic: boolean;
  hasPermission: boolean;
  hasRoles: boolean;
}

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findControllerFiles(p));
    else if (entry.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function discoverRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of findControllerFiles(join(__dirname, '../../modules'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file);
    for (const cls of Object.values(mod) as any[]) {
      if (typeof cls !== 'function') continue;
      if (Reflect.getMetadata('path', cls) === undefined) continue; // não é @Controller
      const clsPublic = Reflect.getMetadata(IS_PUBLIC_KEY, cls);
      const clsPerm = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, cls);
      const clsRoles = Reflect.getMetadata(ROLES_KEY, cls);
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        if (name === 'constructor') continue;
        const handler = cls.prototype[name];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata('path', handler) === undefined) continue; // não é rota
        routes.push({
          id: `${cls.name}.${name}`,
          controller: cls.name,
          isPublic: !!(Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? clsPublic),
          hasPermission: !!(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler) ?? clsPerm),
          hasRoles: !!(Reflect.getMetadata(ROLES_KEY, handler) ?? clsRoles),
        });
      }
    }
  }
  return routes;
}

describe('Cobertura de gate das rotas (#353 — sweep global)', () => {
  const routes = discoverRoutes();

  it('descobriu um volume plausível de rotas (sanidade do glob)', () => {
    // A API tem centenas de rotas; se isto cair muito, o discovery quebrou
    // (e o resto da suíte passaria vazio — falso verde).
    expect(routes.length).toBeGreaterThan(300);
  });

  it('nenhuma rota sem classificação: permissão, @Public ou exceção consciente', () => {
    // #948-C1: `@Roles` saiu da lista de classificações válidas. Com o
    // RolesGuard removido, o decorator não gateia mais nada — uma rota que só
    // tivesse @Roles estaria ABERTA a qualquer autenticado. Contá-lo como
    // gate transformaria justamente esse buraco em teste verde.
    const offenders = routes.filter(
      (r) =>
        !r.isPublic &&
        !r.hasPermission &&
        !SELF_SERVICE_OK.has(r.id) &&
        !PENDING_MIGRATION[r.controller],
    );
    expect(offenders.map((o) => o.id)).toEqual([]);
  });

  it('nenhuma rota usa @Roles — o decorator é inerte desde a #948-C1', () => {
    // O decorator continua existindo só como CHAVE DE DETECÇÃO (esta suíte e
    // os *.access.spec leem ROLES_KEY). Se alguém voltar a aplicá-lo num
    // controller, isto falha e explica por quê: use @RequirePermission.
    const comRoles = routes.filter((r) => r.hasRoles).map((r) => r.id);
    expect(comRoles).toEqual([]);
  });

  it('@Public é allowlist exata — rota pública nova exige revisão consciente', () => {
    const actual = routes.filter((r) => r.isPublic).map((r) => r.id).sort();
    expect(actual).toEqual(PUBLIC_ALLOWLIST);
  });

  it('nenhuma rota @Public carrega @RequirePermission/@Roles (contradição de intenção)', () => {
    const contradictory = routes
      .filter((r) => r.isPublic && (r.hasPermission || r.hasRoles))
      .map((r) => r.id);
    expect(contradictory).toEqual([]);
  });

  it('PENDING_MIGRATION não estagna: controller migrado deve sair da lista', () => {
    const stale = Object.keys(PENDING_MIGRATION).filter((controller) => {
      const controllerRoutes = routes.filter((r) => r.controller === controller);
      if (controllerRoutes.length === 0) return true; // controller nem existe mais
      const stillUngated = controllerRoutes.some(
        (r) => !r.isPublic && !r.hasPermission && !SELF_SERVICE_OK.has(r.id),
      );
      return !stillUngated; // migrou tudo → entrada obsoleta
    });
    expect(stale).toEqual([]);
  });

  it('SELF_SERVICE_OK não estagna: entrada de rota que não existe mais deve sair', () => {
    const ids = new Set(routes.map((r) => r.id));
    const stale = [...SELF_SERVICE_OK].filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });
});
