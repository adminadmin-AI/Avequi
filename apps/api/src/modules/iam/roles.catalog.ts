/**
 * Catálogo dos perfis (roles) system do IAM v2 — issue #339 (Fase F2/M1).
 *
 * 28 perfis padrão (`isSystem = true`): os 24 da issue #339 + ajustes de
 * negócio do Rafael (#463): (a) o perfil "Loja" foi dividido em três em cadeia
 * de herança — LOJA_OPERACIONAL → LOJA_FATURAMENTO → GERENTE_LOJA (venda,
 * faturamento controlado e gerência de filial); (b) GERENTE_GERAL, perfil
 * gerencial amplo que recebe o enum `MANAGER` (antes ia p/ GERENTE_INDUSTRIAL).
 *
 * Coerência: as permissões seguem a matriz RBAC draft da Parte 4.3 da
 * arquitetura e a filosofia do docs/RBAC.md (PR #453): NA DÚVIDA, RESTRINGIR.
 * É mais fácil abrir permissão depois do que fechar um buraco em produção.
 *
 * Herança (`parentCode`): o perfil filho carrega no banco APENAS o delta —
 * o PermissionService (#340) resolve a cadeia parent → child em runtime.
 *
 * ENUM_ROLE_TO_SYSTEM_ROLE: mapeamento 1:1 dos 10 valores do enum `UserRole`
 * atual para o perfil system equivalente (Parte 4.2 da arquitetura), usado
 * pelo espelhamento automático do seed (Fase M1). O enum NÃO é tocado — segue
 * como fallback durante toda a migração.
 */

import {
  moduleCodes,
  resourceCodes,
  actionCodes,
  tenantPermissionCodes,
} from './permissions.catalog';

export interface SystemRoleDef {
  /** Código único do perfil (ex.: 'GERENTE_INDUSTRIAL') */
  code: string;
  /** Nome legível em pt-BR */
  name: string;
  description: string;
  /** Código do perfil pai (herança) — o filho só carrega o delta */
  parentCode?: string;
  /** Codes de permissão concedidos diretamente a este perfil */
  permissions: string[];
  /**
   * OPS WP1 (#908): usuários com este perfil DEVEM ter MFA habilitado
   * (materializado em Role.requireMfa pelo seed). O enforcement por perfil
   * segue SUAVE (decisão pendente do Rafael, #344); nas rotas /ops o
   * OpsMfaGuard aplica o enforcement DURO independente disso.
   */
  requireMfa?: boolean;
}

/** Deduplica preservando ordem */
function dedupe(codes: string[]): string[] {
  return [...new Set(codes)];
}

/**
 * Poderes de EXCEÇÃO do módulo sales (#947) — os que antes moravam no enum
 * legado (DIRECTOR/SUPER_ADMIN hardcoded no código).
 *
 * Existem numa lista própria porque vários perfis recebem vendas por varredura
 * (`moduleCodes('sales')`), e varredura não distingue "operar vendas" de
 * "furar a regra de vendas". Sem esta exclusão, ADMIN_FILIAL e
 * GERENTE_COMERCIAL herdariam os dois poderes sem ninguém ter decidido isso —
 * exatamente o tipo de alargamento silencioso que o #947 existe para acabar.
 *
 * Quem os tem, tem por LISTA EXPLÍCITA (hoje: DIRETOR e, dinamicamente, o
 * ADMIN_GLOBAL/ADMIN_EMPRESA via tenantPermissionCodes()).
 */
const PODERES_EXCECAO_SALES = [
  'sales.discount.override',
  'sales.orders.billing-block-override',
  // #1001-C2: ver a comissão e o PERCENTUAL de todo mundo é dado de
  // remuneração. Vários perfis recebem vendas por varredura e não têm
  // responsabilidade comercial nenhuma — GERENTE_INDUSTRIAL é o exemplo. Fica
  // na lista de exceção pelo mesmo motivo dos outros dois: varredura não
  // distingue "operar vendas" de "ver quanto cada um ganha".
  'sales.commissions.view-all',
];

/** Remove os poderes de exceção de uma varredura ampla do módulo sales (#947). */
const semExcecoesDeVendas = (codes: string[]) =>
  codes.filter((c) => !PODERES_EXCECAO_SALES.includes(c));

/** Dashboards operacionais (todos exceto o financeiro, que é leitura restrita 🔒) */
const DASHBOARDS_OPERACIONAIS = [
  'dashboard.executive.view',
  'dashboard.sales.view',
  'dashboard.production.view',
  'dashboard.stock.view',
  'dashboard.purchases.view',
];

/**
 * Leituras liberadas ao perfil "Somente Leitura" (READER): tudo que é `view`,
 * EXCETO os módulos/recursos sensíveis restritos pelo docs/RBAC.md —
 * financeiro, comissões, usuários, LGPD, fila de aprovações e dashboard
 * financeiro.
 */
const VIEWS_NAO_SENSIVEIS = actionCodes('view').filter(
  (code) =>
    !code.startsWith('finance.') &&
    !code.startsWith('lgpd.') &&
    code !== 'sales.commissions.view' &&
    // #621: alçadas de desconto são config comercial — no legado READER não via
    code !== 'sales.discount-policies.view' &&
    code !== 'settings.users.view' &&
    code !== 'approvals.requests.view' &&
    // #623 (E2, decisão Rafael): regras tributárias são leitura restrita 🔒 —
    // fora do perfil somente-leitura.
    code !== 'fiscal.tax-rules.view' &&
    // #625 (bloco G, decisão Rafael): documentos regulatórios do veículo e
    // status de entrega expõem cliente/logística — fora do somente-leitura.
    code !== 'vehicle-tracking.documents.view' &&
    code !== 'sales.deliveries.view' &&
    code !== 'dashboard.finance.view' &&
    code !== 'suppliers.portal-tokens.view' &&
    // Bloco F (#624, decisão Rafael D4): SOMENTE_LEITURA consulta o funil
    // (crm.leads.view) mas NÃO lê o conteúdo das conversas nem as leituras
    // gerenciais do CRM (dashboard, rodízio, settings).
    (!code.startsWith('crm.') || code === 'crm.leads.view') &&
    // Trilha de auditoria (iam.*) é sensível: fora do perfil somente-leitura
    !code.startsWith('iam.'),
);

/**
 * Bloco F (#624, decisões D1–D7 do Rafael, 13/07/2026) — pacote OPERACIONAL
 * do CRM: as 12 permissões do vendedor. Paridade VENDEDOR × LOJA_OPERACIONAL
 * (D3): os dois perfis recebem exatamente este conjunto.
 */
const CRM_OPERACIONAL = [
  'crm.leads.view',
  'crm.conversations.view',
  'crm.leads.create',
  'crm.leads.move',
  'crm.leads.convert',
  'crm.leads.annotate',
  'crm.messages.send',
  'crm.templates.send',
  'crm.proposals.send',
  'crm.sdr.takeover',
  'crm.connectors.answer',
  'crm.quick-replies.manage',
];

/**
 * Bloco F (#624) — pacote GERENCIAL do CRM SEM as duas ações LGPD
 * (crm.lgpd.anonymize e crm.lgpd.retention-update, exclusivas de
 * GERENTE_GERAL/DIRETOR/ADMIN_EMPRESA/ADMIN_GLOBAL — decisão D5).
 * Lista EXPLÍCITA por decisão do Rafael (D7): nestes perfis NUNCA usam
 * moduleCodes('crm') — cada permissão crm.* futura exige revisão consciente
 * antes de entrar aqui.
 */
const CRM_GERENCIAL_SEM_LGPD = [
  'crm.leads.list',
  'crm.leads.export',
  'crm.leads.reassign',
  'crm.leads.bulk-reassign',
  'crm.leads.bulk-stage',
  'crm.distribution.view',
  'crm.dashboard.view',
  'crm.dashboard.export',
  'crm.portfolio.view', // #846 — leitura gerencial da carteira de clientes
  'crm.settings.view',
  'crm.settings.update',
  'crm.templates.sync',
  'crm.sdr.monitor',
  'crm.sdr.operate',
  'crm.quick-replies.manage-all',
  'crm.reminders.manage-all',
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  // ── Nível Sistema ──────────────────────────────────────────────────────────
  {
    code: 'ADMIN_GLOBAL',
    name: 'Administrador Global',
    description:
      'Administrador do sistema — todas as permissões DE TENANT, inclusive ações globais (criar empresas, sincronizar tabelas de referência). Equivale ao enum SUPER_ADMIN. NÃO inclui o namespace ops.* (control plane da operadora Avecchi — perfil AVECCHI_OPERATOR): admin de cliente não enxerga outros tenants.',
    permissions: tenantPermissionCodes(),
  },

  // ── Nível Operadora (Avecchi — control plane, OPS WP1 #908) ────────────────
  {
    code: 'AVECCHI_OPERATOR',
    name: 'Operador Avecchi',
    description:
      'Time da operadora Avecchi (back-office SaaS): administra as CONTAS de cliente — lifecycle de tenants, suspensão, sandbox. Único perfil com o namespace ops.* (visão cross-tenant). NÃO herda nenhuma permissão intra-tenant: operar dentro de um cliente exige perfil próprio naquele tenant (ou, no futuro, impersonation auditada — WP6 #913). MFA obrigatório: sem MFA ativo, as rotas /ops respondem 403 (OpsMfaGuard).',
    permissions: moduleCodes('ops'),
    requireMfa: true,
  },

  // ── Nível Empresa ──────────────────────────────────────────────────────────
  {
    code: 'ADMIN_EMPRESA',
    name: 'Administrador da Empresa',
    description:
      'Tudo dentro da empresa, exceto ações globais do sistema (criar empresas, sincronizar tabela cClassTrib, ampliar o escopo para o grupo).',
    permissions: tenantPermissionCodes().filter(
      (code) =>
        code !== 'settings.companies.create' &&
        code !== 'fiscal.tributary-classifications.sync' &&
        // #947: o escopo de GRUPO é do ADMIN_GLOBAL. O administrador DA
        // EMPRESA administra a própria empresa — deixá-lo atravessar as
        // demais empresas do grupo contradiz o próprio nome do perfil.
        // Exclusão EXPLÍCITA porque tenantPermissionCodes() é dinâmico:
        // sem esta linha, a capability entraria aqui sozinha.
        code !== 'iam.tenant-scope.cross-company',
    ),
  },
  {
    code: 'ADMIN_FILIAL',
    name: 'Administrador da Filial',
    description:
      'Operação completa no escopo da filial (vendas, compras, estoque, produção); leitura em produtos, qualidade, financeiro e configurações. O recorte por filial é aplicado via branchId no UserRoleAssignment (Decisão 3).',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      ...DASHBOARDS_OPERACIONAIS,
      'dashboard.finance.view',
      ...resourceCodes('dashboard', 'alerts'),
      // #947: varredura ampla NÃO traz os poderes de exceção de vendas.
      ...semExcecoesDeVendas(moduleCodes('sales', 'purchases', 'stock', 'production')),
      'products.catalog.view',
      'products.pricing.view',
      ...moduleCodes('customers'),
      'suppliers.registry.view',
      ...actionCodes('view', ['quality', 'maintenance']),
      'finance.entries.view',
      'finance.reports.view',
      'settings.users.view',
      'settings.companies.view',
      ...moduleCodes('analytics'),
      // #347 (F5.2 fase 1): enxerga a estrutura organizacional da empresa
      // (o recorte por filial vem na fase 2 do enforcement).
      'iam.org.view',
      // Bloco F (#624, D7): opera E gere o CRM da filial (Opção C) — lista
      // explícita, NUNCA moduleCodes('crm'); SEM as duas ações LGPD. Ressalva
      // de arquitetura: vale para o modelo atual Company = loja; se uma
      // Company vier a ter múltiplas filiais no CRM, rever o alcance
      // gerencial na 347-B antes de atribuir este perfil nesse cenário.
      ...CRM_OPERACIONAL,
      ...CRM_GERENCIAL_SEM_LGPD,
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },

  // ── Nível Diretoria ────────────────────────────────────────────────────────
  {
    code: 'DIRETOR',
    name: 'Diretor',
    description:
      'Enxerga tudo (leitura geral), aprova (compras, alçadas, BOM, comissões, orçamentos) e exporta. Não opera o dia-a-dia. Equivale ao enum DIRECTOR. VÊ perfis e permissões em modo leitura (iam.roles.view), mas NÃO gerencia nem atribui acessos (sem iam.roles.manage / iam.roles.assign) e NÃO vê a trilha de auditoria (iam.audit-logs.view). Gestão de perfis e exceções por usuário ficam com ADMIN_GLOBAL/ADMIN_EMPRESA; a trilha de auditoria, com esses + AUDITOR (decisão Rafael, #341/#352).',
    permissions: dedupe([
      // Diretoria vê perfis/permissões (iam.roles.view entra por actionCodes),
      // mas a trilha de auditoria (iam.audit-logs.*) fica FORA — ver descrição.
      // #623 (E1, decisão Rafael): taxas de cartão negociadas (acquirers) são
      // restritas a FINANCEIRO/G.FINANCEIRO/AUDITOR/admins — diretor fora.
      ...actionCodes('view').filter(
        (code) =>
          !code.startsWith('iam.audit-logs.') &&
          code !== 'finance.acquirers.view',
      ),
      'products.catalog.update',
      'production.bom.activate',
      'purchases.orders.approve',
      'purchases.orders.cancel',
      // #622 (decisão Rafael): resolver divergência de 3-way match é APROVAÇÃO
      // de exceção, não operação diária de compra — diretor mantém.
      'purchases.matching.resolve',
      'purchases.rfq.award',
      'purchases.requests.convert',
      'sales.quotations.approve',
      'sales.commissions.approve',
      'sales.commissions.configure',
      // #947: os dois poderes comerciais de exceção que ANTES vinham do enum
      // DIRECTOR hardcoded no código. Agora são permissões — o DIRETOR os tem
      // porque o PERFIL os tem, não porque o enum diz "DIRECTOR".
      // Note que a alçada de desconto continua a ser CONFIGURADA pela gerência
      // comercial (sales.discount-policies.configure, decisão Rafael #621):
      // quem define o teto e quem pode ultrapassá-lo são papéis diferentes.
      'sales.discount.override',
      'sales.orders.billing-block-override',
      'approvals.requests.approve',
      // #623 (E1, decisão Rafael): aprovar investimento é alçada da diretoria
      // (quem gerencia o projeto NÃO aprova); management book é leitura
      // executiva — diretor vê/exporta sem operar o financeiro.
      'finance.investments.approve',
      'finance.reports.export',
      'fiscal.tax-rules.create',
      'fiscal.tax-rules.update',
      'fiscal.tax-rules.delete',
      'lgpd.consents.create',
      'lgpd.consents.revoke',
      'lgpd.anonymization.request',
      'lgpd.anonymization.process',
      'analytics.reports.create',
      'analytics.export.execute',
      'suppliers.portal-tokens.view',
      // #352 (decisão Rafael): DIRETOR NÃO administra acessos IAM — sem
      // iam.roles.manage e sem iam.roles.assign. Gestão de perfis e exceções
      // individuais por usuário ficam restritas a ADMIN_GLOBAL/ADMIN_EMPRESA.
      // O iam.roles.view (leitura) entra pelo actionCodes('view') acima.
      // #347 (F5.2 fase 1, decisão Rafael): estrutura organizacional é CADASTRO
      // da empresa — regra SEPARADA da segurança IAM. Por isso o DIRETOR PODE
      // gerenciar filiais/departamentos/equipes e vínculos, mesmo sem poder
      // gerenciar perfis/permissões. iam.org.view entra pelo actionCodes('view').
      'iam.org.manage',
      'iam.org.assign',
      // Workspace F2: diretor personaliza a própria Home e gere as próprias
      // notas rápidas (as leituras workspace.*.view já entram pelo
      // actionCodes('view') acima; a maioria dos perfis operacionais recebe
      // notes.manage via moduleCodes('workspace'), mas o DIRETOR é curado à mão).
      'workspace.layout.update',
      'workspace.notes.manage',
      // Bloco F (#624, D5): CRM completo 29/29, incluindo as duas ações LGPD
      // (o DIRECTOR legado tinha todas as rotas do CRM — zero regressão).
      // As leituras crm.*.view já entram pelo actionCodes('view') acima.
      ...moduleCodes('crm'),
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },

  // ── Nível Gerência ─────────────────────────────────────────────────────────
  {
    code: 'GERENTE_INDUSTRIAL',
    name: 'Gerente Industrial',
    description:
      'Produção, Estoque, Qualidade e Manutenção completos (CRUD + aprovações); leitura em produtos, vendas e compras.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      ...DASHBOARDS_OPERACIONAIS,
      ...resourceCodes('dashboard', 'alerts'),
      ...moduleCodes('production', 'stock', 'quality', 'maintenance'),
      'products.catalog.view',
      'products.pricing.view',
      ...actionCodes('view', ['sales', 'purchases']),
      'suppliers.registry.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      'analytics.reports.create',
    ]),
  },
  {
    code: 'GERENTE_GERAL',
    name: 'Gerente Geral',
    description:
      'Gerência ampla e transversal (recebe o enum MANAGER): opera e enxerga vendas, compras, estoque e produção (CRUD + aprovações operacionais), dashboards e leitura de financeiro/fiscal. Fatura venda (o MANAGER já faturava). PROTEGIDO por padrão (fora deste perfil): administração de permissões/usuários, configuração bancária/cobrança, ações fiscais críticas (cancelamento NF-e, CC-e, inutilização, regras tributárias), devolução/cancelamento sensível de venda e mudanças estruturais de segurança.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      ...DASHBOARDS_OPERACIONAIS,
      'dashboard.finance.view',
      ...resourceCodes('dashboard', 'alerts'),
      // Vendas: operação + faturar; SEM devolução/cancelamento sensível
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.reserve',
      'sales.orders.confirm',
      'sales.orders.invoice',
      // #621: fluxo de venda completo (pagamentos/TEF/conferência) + alçadas
      // de desconto (o MANAGER legado tinha tudo isso).
      'sales.orders.set-payments',
      'sales.orders.authorize-cards',
      'sales.orders.confer',
      ...resourceCodes('sales', 'discount-policies'),
      // #625 (bloco G): gerência ampla gere transportadoras, entregas e os
      // documentos regulatórios do veículo (decisão Rafael).
      ...resourceCodes('sales', 'carriers'),
      ...resourceCodes('sales', 'deliveries'),
      ...resourceCodes('vehicle-tracking', 'documents'),
      ...resourceCodes('sales', 'quotations'),
      ...resourceCodes('sales', 'demand'),
      ...resourceCodes('sales', 'forecast'),
      'sales.commissions.view',
      ...moduleCodes('customers'),
      // Compras e fornecedores: operação + aprovações
      ...moduleCodes('purchases', 'suppliers'),
      // Estoque e produção: operação completa
      ...moduleCodes('stock', 'production'),
      // Produtos
      'products.catalog.view',
      'products.catalog.create',
      'products.catalog.update',
      'products.pricing.view',
      'products.pricing.create',
      // Financeiro e fiscal: SOMENTE leitura (sem operar/configurar)
      'finance.entries.view',
      'finance.reports.view',
      // #623 (E1, decisão Rafael): gerente amplo ENXERGA planos de investimento
      // e budget por drivers (leitura gerencial); SEM management book e SEM
      // qualquer escrita financeira.
      'finance.investments.view',
      'finance.budget-plans.view',
      'fiscal.documents.view',
      // #622 (decisão Rafael): gerente amplo ENXERGA qualidade e manutenção,
      // mas NÃO opera — mutações ficam com QUALIDADE/G.INDUSTRIAL/ASSISTENCIA.
      'quality.inspections.view',
      'quality.ncr.view',
      'quality.reports.view',
      'maintenance.equipment.view',
      'maintenance.orders.view',
      // Aprovações operacionais
      'approvals.requests.view',
      'approvals.requests.approve',
      // Analytics
      ...moduleCodes('analytics'),
      // Bloco F (#624, D5): CRM completo 29/29 — o MANAGER legado tinha todas
      // as rotas do CRM, incluindo anonimização; GERENTE_GERAL preserva
      // (espelhamento obrigatório, zero regressão).
      ...moduleCodes('crm'),
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },
  {
    code: 'GERENTE_FINANCEIRO',
    name: 'Gerente Financeiro',
    description:
      'Financeiro completo (CRUD + aprovações + configuração) e leitura fiscal (documentos/export, manifestação, regras tributárias); leitura em produtos, vendas e compras. Aprova comissões. A OPERAÇÃO fiscal (eventos NF-e, manifestar, editar regras) é do perfil FISCAL.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      ...DASHBOARDS_OPERACIONAIS,
      'dashboard.finance.view',
      // #623 (E1, decisão Rafael): dono do módulo financeiro — write-off,
      // provisões, régua, adquirentes, conciliação, exports. EXCETO aprovar
      // investimento: alçada é só DIRETOR+admins (quem gerencia não aprova).
      ...moduleCodes('finance').filter(
        (c) => c !== 'finance.investments.approve',
      ),
      // #623 (E2, decisão Rafael): perdeu o fiscal OPERACIONAL amplo que vinha
      // de moduleCodes('fiscal') (eventos NF-e, manifestar, tax-rules CUD,
      // tributary sync) — a operação fiscal é do perfil FISCAL. Mantém só as
      // leituras abaixo.
      'fiscal.documents.view',
      'fiscal.documents.export',
      'fiscal.manifestation.view',
      'fiscal.tax-rules.view',
      'products.catalog.view',
      'products.pricing.view',
      ...actionCodes('view', ['sales', 'purchases']),
      'sales.orders.invoice',
      'sales.commissions.approve',
      'purchases.matching.view',
      'purchases.matching.execute',
      'purchases.matching.resolve',
      ...resourceCodes('purchases', 'inbound-nfe'),
      'customers.registry.view',
      'suppliers.registry.view',
      'approvals.requests.view',
      'approvals.requests.approve',
      // #625 (bloco G): documentos regulatórios do veículo fora do financeiro
      // (view/manage restritos — decisão Rafael).
      ...moduleCodes('analytics', 'vehicle-tracking').filter(
        (c) => !c.startsWith('vehicle-tracking.documents.'),
      ),
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },
  {
    code: 'GERENTE_COMERCIAL',
    name: 'Gerente Comercial',
    description:
      'Vendas, orçamentos, clientes, demanda e forecast completos (CRUD + aprovações); leitura de contas a receber e estoque.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      ...DASHBOARDS_OPERACIONAIS,
      ...resourceCodes('dashboard', 'alerts'),
      // #625 (bloco G, decisão Rafael): atualizar STATUS de entrega é
      // operação de expedição/loja — comercial acompanha (view), não executa.
      // #947: além da entrega, a varredura também não traz desconto
      // excepcional nem override de faturamento bloqueado — comercial VENDE,
      // a exceção comercial é da diretoria.
      ...semExcecoesDeVendas(
        moduleCodes('sales', 'customers').filter((c) => c !== 'sales.deliveries.update'),
      ),
      'products.catalog.view',
      'products.catalog.update',
      'products.pricing.view',
      'products.pricing.create',
      'stock.balances.view',
      'finance.entries.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      'analytics.reports.create',
      'analytics.export.execute',
      // Bloco F (#624, D5/D7): dono do domínio comercial — CRM operacional +
      // gerencial completos por lista explícita; SEM as duas ações LGPD
      // (anonymize/retention-update, exclusivas da alta gestão).
      ...CRM_OPERACIONAL,
      ...CRM_GERENCIAL_SEM_LGPD,
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },
  {
    code: 'GERENTE_COMPRAS',
    name: 'Gerente de Compras',
    description:
      'Compras, RFQ, recebimento e fornecedores completos (CRUD + aprovações); leitura de contas a pagar e estoque.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      ...DASHBOARDS_OPERACIONAIS,
      ...resourceCodes('dashboard', 'alerts'),
      ...moduleCodes('purchases', 'suppliers'),
      'products.catalog.view',
      'products.pricing.view',
      'stock.balances.view',
      'stock.movements.view',
      'finance.entries.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      'analytics.reports.create',
    ]),
  },

  // ── Nível Supervisão (herança) ─────────────────────────────────────────────
  {
    code: 'SUPERVISOR_PRODUCAO',
    name: 'Supervisor de Produção',
    description:
      'Herda Operador de Produção e acrescenta liberar/concluir/cancelar ordens e aprovar/reprovar inspeções.',
    parentCode: 'OPERADOR_PRODUCAO',
    permissions: [
      'production.orders.create',
      'production.orders.release',
      'production.orders.complete',
      'production.orders.cancel',
      'production.orders.approve',
      'production.orders.reject',
      'production.scheduling.generate',
    ],
  },
  {
    code: 'SUPERVISOR_ESTOQUE',
    name: 'Supervisor de Estoque',
    description:
      'Herda Almoxarife e acrescenta as ações destrutivas/de aprovação: estorno de movimentação, cancelamento de transferências, reconciliação e cancelamento de inventário, configuração do WMS.',
    parentCode: 'ALMOXARIFE',
    permissions: [
      'stock.movements.reverse',
      'stock.transfers.cancel',
      'stock.inventory.reconcile',
      'stock.inventory.cancel',
      'stock.wms.configure',
      'stock.batches.adjust',
    ],
  },
  {
    code: 'COORDENADOR_COMERCIAL',
    name: 'Coordenador Comercial',
    description:
      'Herda Vendedor e acrescenta aprovar/rejeitar/expirar orçamentos e cancelar pedidos de venda.',
    parentCode: 'VENDEDOR',
    permissions: [
      'sales.quotations.approve',
      'sales.quotations.reject',
      'sales.quotations.expire',
      'sales.quotations.delete',
      'sales.orders.cancel',
      // Bloco F (#624, D6): coordenador ACOMPANHA (lista mestre, dashboard,
      // rodízio, monitor da SDR) e resolve ajustes individuais do dia a dia
      // (reatribuir UM lead — almoço/falta/lead mal encaixado). SEM operações
      // em massa, exports, settings, sdr.operate, LGPD e SEM as complementares
      // de gestão (quick-replies.manage-all / reminders.manage-all).
      'crm.leads.list',
      'crm.dashboard.view',
      'crm.distribution.view',
      'crm.sdr.monitor',
      'crm.leads.reassign',
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ],
  },

  // ── Nível Operacional ──────────────────────────────────────────────────────
  {
    code: 'COMPRADOR',
    name: 'Comprador',
    description:
      'Cria e edita pedidos de compra, solicitações e RFQs; NÃO aprova pedido (segregação de funções). Leitura de fornecedores, produtos e estoque.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.purchases.view',
      'dashboard.stock.view',
      'purchases.orders.view',
      'purchases.orders.create',
      'purchases.orders.update',
      'purchases.receiving.view',
      'purchases.requests.view',
      'purchases.requests.create',
      'purchases.requests.cancel',
      ...resourceCodes('purchases', 'rfq').filter((c) => c !== 'purchases.rfq.award'),
      'purchases.supplier-prices.view',
      'purchases.inbound-nfe.view',
      'suppliers.registry.view',
      'products.catalog.view',
      'products.pricing.view',
      'stock.balances.view',
    ]),
  },
  {
    code: 'VENDEDOR',
    name: 'Vendedor',
    description:
      'Cria e conduz orçamentos e pedidos de venda (criar/reservar/confirmar/enviar/converter); mantém clientes; vê as próprias comissões. NÃO fatura (fiscal/financeiro) nem aprova orçamento (Coordenador). Equivale ao enum COMMERCIAL.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.sales.view',
      'dashboard.executive.view',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.reserve',
      'sales.orders.confirm',
      // #625 (bloco G): vendedor consulta transportadoras e acompanha a
      // entrega da venda (leitura).
      'sales.carriers.view',
      'sales.deliveries.view',
      // #621: vendedor conduz a venda até o faturamento (plano de pagamento,
      // TEF e conferência de carga — o COMMERCIAL legado fazia os três) e VÊ
      // as alçadas de desconto (sem configurar).
      'sales.orders.set-payments',
      'sales.orders.authorize-cards',
      'sales.orders.confer',
      'sales.discount-policies.view',
      'sales.quotations.view',
      'sales.quotations.create',
      'sales.quotations.update',
      'sales.quotations.send',
      'sales.quotations.convert',
      // #621 (decisão Rafael): configurar horizonte de MRP é planejamento/
      // gestão — fora do vendedor (o legado já restringia a SA/MANAGER).
      ...resourceCodes('sales', 'demand').filter(
        (c) => c !== 'sales.demand.configure',
      ),
      ...resourceCodes('sales', 'forecast'),
      'sales.commissions.view',
      // #620: vendedor mantém clientes (inclui adicionar/editar endereço de
      // entrega), mas REMOVER endereço é de gerência (espelha o legado, onde
      // DELETE /customers/:id/addresses era só SA/DIRECTOR/MANAGER).
      ...moduleCodes('customers').filter(
        (c) => c !== 'customers.addresses.delete',
      ),
      'products.catalog.view',
      'products.catalog.create',
      'products.pricing.view',
      'products.pricing.create',
      'stock.balances.view',
      // Bloco F (#624, D1–D3): vendedor opera o CRM da loja inteira — vê e
      // atua em qualquer lead da loja (atuar não muda o assignedTo).
      ...CRM_OPERACIONAL,
    ]),
  },
  {
    code: 'OPERADOR_PCP',
    name: 'Operador PCP',
    description:
      'Planejamento e controle da produção: cria ordens, roda MRP e converte sugestões, gera sequenciamento; leitura de BOM, roteiros, capacidade, estoque e compras. Recebe os usuários do enum PRODUCTION na migração.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.production.view',
      'dashboard.stock.view',
      'production.orders.view',
      'production.orders.create',
      ...resourceCodes('production', 'mrp'),
      'production.bom.view',
      'production.routing.view',
      ...resourceCodes('production', 'scheduling'),
      'production.work-centers.view',
      'products.catalog.view',
      'stock.balances.view',
      'stock.movements.view',
      // #621 (decisão Rafael): PCP opera o chão de fábrica de verdade — o enum
      // PRODUCTION legado movimentava estoque, criava/vinculava séries e
      // criava/consumia lotes; sem estes grants a produção trava no dia
      // seguinte à migração dos controllers de estoque.
      'stock.movements.create',
      'stock.serials.create',
      'stock.serials.update',
      'stock.serials.link',
      'stock.batches.create',
      'stock.batches.consume',
      ...actionCodes('view', ['purchases']),
      'sales.demand.view',
      'sales.forecast.view',
    ]),
  },
  {
    code: 'OPERADOR_PRODUCAO',
    name: 'Operador de Produção',
    description:
      'Chão de fábrica: vê ordens, inicia e aponta produção; leitura de estoque, BOM e roteiros.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.production.view',
      'production.orders.view',
      'production.orders.start',
      'production.orders.execute',
      'production.bom.view',
      'production.routing.view',
      'production.scheduling.view',
      'production.work-centers.view',
      'products.catalog.view',
      'stock.balances.view',
      // #621 (decisão Rafael): apontamento do chão de fábrica — consome lote e
      // vincula série à OP/venda. SEM criar/editar série (fica no PCP; só com
      // dependência operacional comprovada e reportada).
      'stock.batches.consume',
      'stock.serials.link',
    ]),
  },
  {
    code: 'ALMOXARIFE',
    name: 'Almoxarife',
    description:
      'Estoque operacional completo: movimentações, transferências, lotes, séries, WMS (execução), recebimento de compras, NF-e de entrada e solicitações de compra. Equivale ao enum WAREHOUSE.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.stock.view',
      'dashboard.purchases.view',
      'stock.balances.view',
      'stock.movements.view',
      'stock.movements.create',
      ...resourceCodes('stock', 'transfers').filter((c) => c !== 'stock.transfers.cancel'),
      ...resourceCodes('stock', 'batches').filter(
        (c) => !['stock.batches.quarantine', 'stock.batches.release', 'stock.batches.scrap'].includes(c),
      ),
      ...resourceCodes('stock', 'serials').filter((c) => c !== 'stock.serials.scrap'),
      'stock.warehouses.view',
      'stock.wms.view',
      'stock.wms.execute',
      'stock.inventory.create',
      // #625 (bloco G): expedição — atualiza status de entrega pós-NF-e
      // (o WAREHOUSE legado fazia) e consulta transportadoras.
      'sales.deliveries.view',
      'sales.deliveries.update',
      'sales.carriers.view',
      'purchases.receiving.view',
      'purchases.receiving.create',
      'purchases.requests.view',
      'purchases.requests.create',
      'purchases.requests.cancel',
      'purchases.orders.view',
      'purchases.rfq.view',
      'purchases.rfq.create',
      'purchases.rfq.quote',
      'purchases.inbound-nfe.view',
      'purchases.inbound-nfe.upload',
      'purchases.inbound-nfe.match',
      'products.catalog.view',
      'suppliers.registry.view',
    ]),
  },
  {
    code: 'FINANCEIRO',
    name: 'Financeiro',
    description:
      'Contas a pagar/receber (CRUD + baixa/pagamento), cobrança, boletos, PIX, agendamentos, faturamento de vendas e conciliação 3-way; contas bancárias somente leitura (gestão é do Gerente Financeiro). Equivale ao enum FINANCIAL.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.finance.view',
      'dashboard.executive.view',
      // #623 (E1, decisão Rafael): FINANCEIRO opera o dia a dia mas NÃO faz
      // write-off (baixa como perda é do Gerente Financeiro) nem configura.
      ...resourceCodes('finance', 'entries').filter(
        (c) => c !== 'finance.entries.write-off',
      ),
      'finance.bank-accounts.view',
      ...resourceCodes('finance', 'categories').filter((c) => c !== 'finance.categories.delete'),
      ...resourceCodes('finance', 'cost-centers').filter((c) => c !== 'finance.cost-centers.delete'),
      'finance.reports.view',
      'finance.banking.view',
      ...resourceCodes('finance', 'payment-schedules'),
      ...resourceCodes('finance', 'boletos'),
      ...resourceCodes('finance', 'pix'),
      // #623 (E1): dispara a cobrança (view/execute), mas a RÉGUA é config de
      // gerência (billing.configure fica fora).
      ...resourceCodes('finance', 'billing').filter(
        (c) => c !== 'finance.billing.configure',
      ),
      'finance.budget.view',
      // #623 (E1, decisões Rafael): operação diária do financeiro —
      // provisões só leitura (configurar é gerência); adiantamentos sem
      // cancelar (cancelamento é gerência); dívidas completas (view/create/
      // pay); conciliação bancária; taxas de adquirente só leitura;
      // investimentos e budget-plans só leitura (manage é gerência; approve
      // é diretoria).
      'finance.provisions.view',
      'finance.advances.view',
      'finance.advances.create',
      ...resourceCodes('finance', 'debts'),
      'finance.reconciliation.execute',
      'finance.acquirers.view',
      'finance.investments.view',
      'finance.budget-plans.view',
      'fiscal.documents.view',
      'fiscal.manifestation.view',
      'sales.orders.view',
      'sales.orders.invoice',
      'sales.commissions.view',
      'sales.commissions.approve',
      'purchases.orders.view',
      'purchases.matching.view',
      'purchases.matching.execute',
      'purchases.inbound-nfe.view',
      'purchases.inbound-nfe.import',
      'customers.registry.view',
      'suppliers.registry.view',
      // #620 (decisão Rafael): financeiro consulta o cadastro de produto
      // (conferência de NF/faturamento), mas NÃO vê preço comercial
      // (products.pricing.* fica fora — mais sensível).
      'products.catalog.view',
      // #621: financeiro VÊ alçadas de desconto (o FINANCIAL legado via),
      // sem configurar.
      'sales.discount-policies.view',
      // #625 (bloco G, decisão Rafael): financeiro acompanha a entrega (view,
      // p/ faturamento/cobrança) mas NÃO atualiza status; e NÃO recebe os
      // documentos regulatórios do veículo (o legado dava manage ao FINANCIAL).
      'sales.deliveries.view',
      ...moduleCodes('vehicle-tracking').filter(
        (c) => !c.startsWith('vehicle-tracking.documents.'),
      ),
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },
  {
    code: 'FISCAL',
    name: 'Fiscal',
    description:
      'Documentos fiscais e eventos de NF-e (cancelamento, CC-e, inutilização, reprocesso), manifestação do destinatário e NF-e de entrada; leitura do financeiro e das regras tributárias.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.finance.view',
      ...moduleCodes('fiscal').filter(
        (c) => !['fiscal.tax-rules.create', 'fiscal.tax-rules.update', 'fiscal.tax-rules.delete', 'fiscal.tributary-classifications.sync'].includes(c),
      ),
      'finance.entries.view',
      'finance.reports.view',
      ...resourceCodes('purchases', 'inbound-nfe'),
      // #625 (bloco G, decisão Rafael): CAT/CCT/projeto técnico são documentos
      // REGULATÓRIOS do veículo — o perfil fiscal vê e gere.
      ...resourceCodes('vehicle-tracking', 'documents'),
      'sales.orders.view',
      'sales.orders.invoice',
      'purchases.orders.view',
      'customers.registry.view',
      'suppliers.registry.view',
      'products.catalog.view',
    ]),
  },
  {
    code: 'RH',
    name: 'RH',
    description:
      'Gestão de usuários (ver, criar, editar — sem excluir; desativação é edição) e da alocação organizacional (#347 F5.2): vê a estrutura (filiais/departamentos/equipes) e vincula usuários a departamentos e equipes. NÃO cria/edita a estrutura em si (isso é do DIRETOR/admins).',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.executive.view',
      ...resourceCodes('settings', 'users'),
      'settings.companies.view',
      // #347 (F5.2 fase 1): RH aloca pessoas na estrutura organizacional
      'iam.org.view',
      'iam.org.assign',
    ]),
  },
  {
    code: 'QUALIDADE',
    name: 'Qualidade',
    description:
      'Inspeções e NCRs completos; quarentena/liberação/sucateamento de lotes e séries; aprova/reprova inspeções de produção. Equivale ao enum QUALITY.',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.production.view',
      'dashboard.stock.view',
      ...moduleCodes('quality'),
      'production.orders.view',
      'production.orders.approve',
      'production.orders.reject',
      'stock.balances.view',
      'stock.batches.view',
      'stock.batches.create',
      'stock.batches.quarantine',
      'stock.batches.release',
      'stock.batches.scrap',
      'stock.batches.check-expired',
      'stock.serials.view',
      'stock.serials.scrap',
      'products.catalog.view',
      'suppliers.registry.view',
    ]),
  },
  {
    code: 'ASSISTENCIA_TECNICA',
    name: 'Assistência Técnica',
    description:
      'Manutenção completa (equipamentos e ordens); leitura de produtos, estoque e números de série (rastreabilidade).',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.production.view',
      ...moduleCodes('maintenance'),
      'products.catalog.view',
      'stock.balances.view',
      'stock.serials.view',
      'stock.batches.view',
      // #625 (bloco G): pós-venda consulta os documentos do veículo (CAT/CCT)
      // para atender o cliente — leitura apenas.
      'vehicle-tracking.documents.view',
    ]),
  },

  // ── Nível Restrito ─────────────────────────────────────────────────────────
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description:
      'Vê TUDO (inclusive financeiro, comissões, usuários, LGPD, fila de aprovações e a trilha de auditoria iam.audit-logs) e exporta; nenhuma mutação.',
    permissions: dedupe([
      // Bloco F (#624, decisão Rafael D4): no CRM o auditor lê o funil e as
      // conversas (crm.leads.view + crm.conversations.view, que entram pelo
      // actionCodes abaixo); as leituras GERENCIAIS do CRM (rodízio,
      // dashboard, settings) ficam FORA — ampliação só por decisão específica.
      ...actionCodes('view').filter(
        (code) =>
          !code.startsWith('crm.') ||
          code === 'crm.leads.view' ||
          code === 'crm.conversations.view',
      ),
      'analytics.export.execute',
      // #623 (E1, decisão Rafael): auditor exporta os pacotes de auditoria —
      // management book e massa fiscal (XMLs) — sem nenhuma mutação.
      'finance.reports.export',
      'fiscal.documents.export',
      // #1001-C2: visão ampla de comissões e percentuais (matriz aprovada).
      'sales.commissions.view-all',
    ]),
  },
  {
    code: 'SOMENTE_LEITURA',
    name: 'Somente Leitura',
    description:
      'Leitura dos dados operacionais, sem nenhuma mutação e sem os módulos sensíveis (financeiro, comissões, usuários, LGPD, aprovações). Equivale ao enum READER.',
    permissions: VIEWS_NAO_SENSIVEIS,
  },
  {
    code: 'VISITANTE',
    name: 'Visitante',
    description: 'Apenas os dashboards operacionais (sem o financeiro). Nenhum dado detalhado.',
    permissions: [...DASHBOARDS_OPERACIONAIS],
  },

  // ── Loja / Filial — split controlado (decisão Rafael, #463) ────────────────
  // Em vez de um único perfil "Loja" poderoso, três perfis em cadeia de herança:
  // operação → faturamento → gerência. O faturamento (emitir NF-e) NÃO é
  // liberado automaticamente: exige atribuir LOJA_FATURAMENTO explicitamente.
  {
    code: 'LOJA_OPERACIONAL',
    name: 'Loja — Operação',
    description:
      'Operação de balcão da loja/filial: vende (criar/reservar/confirmar pedido), cadastra cliente, transferências entre filiais e solicitações de compra; leitura de produto, preço e estoque. NÃO fatura (sem NF-e), não devolve nem cancela venda. Escopo por filial via branchId. Recebe os usuários do enum STORE na migração (espelhamento 1:1).',
    permissions: dedupe([
      // Workspace (Home por papel, F1): resumo do dia, pendências e agenda —
      // o conteúdo é curado por permissão dentro do service (menor privilégio).
      ...moduleCodes('workspace'),
      'dashboard.stock.view',
      'dashboard.sales.view',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.reserve',
      'sales.orders.confirm',
      // #621: balcão conduz a própria venda até o gate do faturamento — plano
      // de pagamento, TEF e conferência (o STORE legado fazia os três). FATURAR
      // segue exclusivo do LOJA_FATURAMENTO (split #463, reconfirmado no PR C).
      'sales.orders.set-payments',
      'sales.orders.authorize-cards',
      'sales.orders.confer',
      'customers.registry.view',
      'customers.registry.create',
      // #620: balcão ADICIONA endereço de entrega na venda (regra própria da
      // família customers.addresses — não edita nem remove).
      'customers.addresses.create',
      'stock.balances.view',
      // #620: a loja cria transferência entre filiais — sem ver a lista de
      // depósitos a tela de transferência quebra (decisão Rafael).
      'stock.warehouses.view',
      'stock.transfers.view',
      'stock.transfers.create',
      'stock.transfers.dispatch',
      'stock.transfers.receive',
      'purchases.requests.view',
      'purchases.requests.create',
      'purchases.requests.cancel',
      'products.catalog.view',
      'products.pricing.view',
      // #625 (bloco G): a loja acompanha e atualiza o status da entrega da
      // própria venda (o STORE legado fazia) — decisão Rafael.
      'sales.deliveries.view',
      'sales.deliveries.update',
      // Bloco F (#624, D3): paridade com o VENDEDOR no CRM — o balcão atende
      // WhatsApp, conduz e converte o lead da loja (o STORE legado fazia).
      ...CRM_OPERACIONAL,
    ]),
  },
  {
    code: 'LOJA_FATURAMENTO',
    name: 'Loja — Faturamento',
    description:
      'Herda Loja — Operação e acrescenta faturar/emitir NF-e do pedido de venda + leitura de documentos fiscais. NÃO cancela NF-e nem faz financeiro. Atribuído manualmente pelo admin a quem realmente fatura na loja (faturamento não é liberado a todo usuário de loja).',
    parentCode: 'LOJA_OPERACIONAL',
    permissions: [
      'sales.orders.invoice',
      'fiscal.documents.view',
    ],
  },
  {
    code: 'GERENTE_LOJA',
    name: 'Gerente de Loja',
    description:
      'Herda Loja — Faturamento e acrescenta visão gerencial da filial: dashboards, acompanhamento de vendas/estoque, orçamentos, comissões e alertas. NÃO inclui devolução/cancelamento sensível de venda (reservado para permissão/fase futura) nem cancelamento fiscal crítico. Escopo por filial via branchId.',
    parentCode: 'LOJA_FATURAMENTO',
    permissions: dedupe([
      'dashboard.executive.view',
      'dashboard.purchases.view',
      ...resourceCodes('dashboard', 'alerts'),
      'stock.movements.view',
      'sales.quotations.view',
      'sales.commissions.view',
      // #1001-C2 (decisão Rafael): administra a equipe comercial da loja e
      // precisa ver a comissão e a regra dos vendedores sob sua gestão. Sem
      // isto veria apenas a própria. O escopo continua sendo a Company do
      // JWT — a filial —, sem visão cross-tenant.
      'sales.commissions.view-all',
      // #625 (bloco G): gerência da filial consulta transportadoras.
      'sales.carriers.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      // Bloco F (#624, D5/D7): gere o CRM da loja (as 12 operacionais vêm por
      // herança de LOJA_OPERACIONAL); lista explícita — SEM crm.lgpd.anonymize
      // e SEM crm.lgpd.retention-update (exclusivas da alta gestão).
      ...CRM_GERENCIAL_SEM_LGPD,
    ]),
  },
];

/**
 * Mapeamento 1:1 do enum `UserRole` atual → code do perfil system equivalente
 * (Parte 4.2 da arquitetura, coluna 4 na direção inversa). Usado pelo
 * espelhamento automático do seed: cada usuário ganha um UserRoleAssignment
 * apontando para o perfil equivalente ao seu `User.role`.
 *
 * Chaves em string (e não `UserRole` do @prisma/client) para o catálogo não
 * depender do client gerado; o seed valida contra o enum real.
 */
export const ENUM_ROLE_TO_SYSTEM_ROLE: Record<string, string> = {
  SUPER_ADMIN: 'ADMIN_GLOBAL',
  DIRECTOR: 'DIRETOR',
  // MANAGER = "Gerente Geral" no negócio (não "Gerente Industrial") — decisão
  // Rafael #463. GERENTE_INDUSTRIAL segue no catálogo para uso real em gerência
  // industrial, mas o enum antigo mapeia para o perfil amplo GERENTE_GERAL.
  MANAGER: 'GERENTE_GERAL',
  COMMERCIAL: 'VENDEDOR',
  PRODUCTION: 'OPERADOR_PCP',
  QUALITY: 'QUALIDADE',
  WAREHOUSE: 'ALMOXARIFE',
  FINANCIAL: 'FINANCEIRO',
  STORE: 'LOJA_OPERACIONAL',
  READER: 'SOMENTE_LEITURA',
};

/** Busca um perfil system por code */
export function findSystemRole(code: string): SystemRoleDef | undefined {
  return SYSTEM_ROLES.find((role) => role.code === code);
}

/**
 * Resolve o conjunto EFETIVO de permissões de um perfil, seguindo a cadeia de
 * herança (parent → child). Útil para testes e para o shadow mode (#340).
 */
export function resolveEffectivePermissions(code: string): string[] {
  const seen = new Set<string>();
  const result = new Set<string>();
  let current = findSystemRole(code);
  while (current) {
    if (seen.has(current.code)) {
      throw new Error(`Ciclo de herança detectado em '${current.code}'`);
    }
    seen.add(current.code);
    current.permissions.forEach((p) => result.add(p));
    current = current.parentCode ? findSystemRole(current.parentCode) : undefined;
  }
  return [...result];
}
