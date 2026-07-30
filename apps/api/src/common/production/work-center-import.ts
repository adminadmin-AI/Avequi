/**
 * Lógica do importador de centros de trabalho (issue #816).
 *
 * Tudo aqui é puro ou recebe o cliente de banco por injeção — o CLI
 * (`apps/api/scripts/import-work-centers.ts`) é só um adaptador fino.
 *
 * Regras de negócio (aprovadas na issue #816):
 *   - Chave natural do upsert: (companyId, code). O code nunca é alterado.
 *   - Campos ADMINISTRADOS pelo importador: name, description, isActive.
 *   - Campos que o importador NUNCA sobrescreve em update: capacityHoursPerDay,
 *     costPerHour, operatorsCount, efficiencyPct (na criação, ficam nos
 *     defaults do schema — o script não os grava).
 *   - isActive por tipo de origem: Producao/Opcional → ativo,
 *     Estoque/Apoio → inativo.
 *   - Centro presente no ERP e ausente do arquivo: só relatado; nunca excluído;
 *     desativado apenas com deactivateMissing explícito.
 *   - Empresa resolvida por CNPJ em igualdade EXATA; 0 ou >1 resultados abortam.
 */

import type { WorkCenterSeed, WorkCenterSourceType } from '../../modules/production/data/work-centers.data';

/** CNPJ padrão da empresa de destino — GDR Reboques. */
export const DEFAULT_TARGET_COMPANY_CNPJ = '46247069000115';

const ACTIVE_BY_TYPE: Record<WorkCenterSourceType, boolean> = {
  Producao: true,
  Opcional: true,
  Estoque: false,
  Apoio: false,
};

/** `Producao`/`Opcional` → ativo; `Estoque`/`Apoio` → inativo. */
export function resolveIsActive(type: WorkCenterSourceType): boolean {
  const active = ACTIVE_BY_TYPE[type];
  if (active === undefined) {
    throw new Error(`Tipo de setor desconhecido: "${type}" — tipos aceitos: ${Object.keys(ACTIVE_BY_TYPE).join(', ')}`);
  }
  return active;
}

/** Description padronizada: "Grupo · Tipo" (mapeamento da issue #816). */
export function buildDescription(seed: Pick<WorkCenterSeed, 'group' | 'type'>): string {
  return `${seed.group} · ${seed.type}`;
}

/** Estado desejado de um centro, derivado do arquivo de dados. */
export interface DesiredWorkCenter {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

export function toDesired(seed: WorkCenterSeed): DesiredWorkCenter {
  return {
    code: seed.code,
    name: seed.name,
    description: buildDescription(seed),
    isActive: resolveIsActive(seed.type),
  };
}

/** Recorte de WorkCenter existente no ERP que interessa à comparação. */
export interface ExistingWorkCenter {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface UpdatePlanEntry {
  id: string;
  code: string;
  /** Somente os campos administrados que realmente divergem. */
  changes: Partial<Pick<DesiredWorkCenter, 'name' | 'description' | 'isActive'>>;
}

export interface SyncPlan {
  create: DesiredWorkCenter[];
  update: UpdatePlanEntry[];
  unchanged: DesiredWorkCenter[];
  /** No ERP, mas fora do arquivo — nunca excluídos. */
  missing: ExistingWorkCenter[];
  /** Ausentes que seriam desativados com --deactivate-missing (só os ativos). */
  missingToDeactivate: ExistingWorkCenter[];
}

/**
 * Compara o arquivo de dados com os centros existentes e monta o plano.
 * Não escreve nada — quem decide aplicar é o chamador.
 */
export function planWorkCenterSync(
  seeds: readonly WorkCenterSeed[],
  existing: readonly ExistingWorkCenter[],
): SyncPlan {
  const codes = new Set<string>();
  for (const seed of seeds) {
    if (codes.has(seed.code)) {
      throw new Error(`Arquivo de dados inválido: code duplicado "${seed.code}"`);
    }
    codes.add(seed.code);
  }

  const byCode = new Map(existing.map((wc) => [wc.code, wc]));
  const plan: SyncPlan = { create: [], update: [], unchanged: [], missing: [], missingToDeactivate: [] };

  for (const seed of seeds) {
    const desired = toDesired(seed);
    const current = byCode.get(seed.code);
    if (!current) {
      plan.create.push(desired);
      continue;
    }
    const changes: UpdatePlanEntry['changes'] = {};
    if (current.name !== desired.name) changes.name = desired.name;
    if (current.description !== desired.description) changes.description = desired.description;
    if (current.isActive !== desired.isActive) changes.isActive = desired.isActive;

    if (Object.keys(changes).length > 0) {
      plan.update.push({ id: current.id, code: current.code, changes });
    } else {
      plan.unchanged.push(desired);
    }
  }

  for (const wc of existing) {
    if (!codes.has(wc.code)) {
      plan.missing.push(wc);
      if (wc.isActive) plan.missingToDeactivate.push(wc);
    }
  }

  return plan;
}

/** Recorte de Company que interessa à resolução. */
export interface CompanyCandidate {
  id: string;
  cnpj: string;
  name: string;
}

/**
 * Valida o resultado da busca por CNPJ exato: 0 → erro, >1 → erro, 1 → segue.
 * O schema tem `Company.cnpj @unique`, o que torna >1 estruturalmente
 * impossível hoje — a checagem fica mesmo assim, como exige a issue, para o
 * caso de a constraint mudar ou de a busca ser alterada no futuro.
 */
export function resolveTargetCompany(candidates: readonly CompanyCandidate[], cnpj: string): CompanyCandidate {
  if (candidates.length === 0) {
    throw new Error(
      `Nenhuma empresa encontrada com CNPJ exatamente igual a "${cnpj}". ` +
        'Confira o cadastro ou use TARGET_COMPANY_CNPJ para apontar a empresa correta.',
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `CNPJ "${cnpj}" ambíguo: ${candidates.length} empresas encontradas ` +
        `(${candidates.map((c) => c.name).join(', ')}). Abortando — nunca escolher a primeira.`,
    );
  }
  return candidates[0];
}

/** Interface mínima do cliente de banco usada pelo importador (mockável). */
export interface WorkCenterImportDb {
  company: {
    findMany(args: { where: { cnpj: string }; select: { id: true; cnpj: true; name: true } }): Promise<CompanyCandidate[]>;
  };
  workCenter: {
    findMany(args: {
      where: { companyId: string };
      select: { id: true; code: true; name: true; description: true; isActive: true };
    }): Promise<ExistingWorkCenter[]>;
    create(args: { data: DesiredWorkCenter & { companyId: string } }): Promise<unknown>;
    update(args: { where: { id: string }; data: Partial<DesiredWorkCenter> }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: WorkCenterImportDb) => Promise<T>): Promise<T>;
}

export interface ImportOptions {
  /** Sem apply, NENHUMA escrita acontece (dry-run). */
  apply: boolean;
  /** Só tem efeito junto com apply: desativa (nunca exclui) os ausentes. */
  deactivateMissing: boolean;
  /** CNPJ da empresa de destino (igualdade exata). */
  targetCnpj: string;
}

export interface ImportResult {
  company: CompanyCandidate;
  plan: SyncPlan;
  applied: boolean;
  created: number;
  updated: number;
  deactivated: number;
}

/**
 * Executa o importador: resolve a empresa, monta o plano e — somente com
 * `apply` — grava tudo numa transação (plano parcialmente aplicado nunca fica
 * no banco). `companyId` vem exclusivamente da empresa resolvida por CNPJ.
 */
export async function runWorkCenterImport(
  db: WorkCenterImportDb,
  seeds: readonly WorkCenterSeed[],
  options: ImportOptions,
): Promise<ImportResult> {
  const candidates = await db.company.findMany({
    where: { cnpj: options.targetCnpj },
    select: { id: true, cnpj: true, name: true },
  });
  const company = resolveTargetCompany(candidates, options.targetCnpj);

  const existing = await db.workCenter.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true, name: true, description: true, isActive: true },
  });
  const plan = planWorkCenterSync(seeds, existing);

  if (!options.apply) {
    return { company, plan, applied: false, created: 0, updated: 0, deactivated: 0 };
  }

  const { created, updated, deactivated } = await db.$transaction(async (tx) => {
    let createdCount = 0;
    let updatedCount = 0;
    let deactivatedCount = 0;

    for (const desired of plan.create) {
      // Só os campos administrados + companyId; capacidade/custo/operadores/
      // eficiência ficam nos defaults do schema.
      await tx.workCenter.create({ data: { ...desired, companyId: company.id } });
      createdCount++;
    }
    for (const entry of plan.update) {
      await tx.workCenter.update({ where: { id: entry.id }, data: entry.changes });
      updatedCount++;
    }
    if (options.deactivateMissing) {
      for (const wc of plan.missingToDeactivate) {
        await tx.workCenter.update({ where: { id: wc.id }, data: { isActive: false } });
        deactivatedCount++;
      }
    }
    return { created: createdCount, updated: updatedCount, deactivated: deactivatedCount };
  });

  return { company, plan, applied: true, created, updated, deactivated };
}
