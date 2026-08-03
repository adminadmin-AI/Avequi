/**
 * Núcleo GENÉRICO de sincronização de centros de trabalho (WorkCenter).
 *
 * Reutilizável por qualquer empresa/implantação: opera exclusivamente sobre o
 * estado final desejado ({ code, name, description, isActive }) e recebe dados,
 * empresa-alvo e cliente de banco por injeção. Não conhece nenhuma empresa,
 * CNPJ, taxonomia de origem ou regra de negócio específica de implantação —
 * isso pertence ao dataset/adaptador de cada carga (em
 * `src/modules/production/data/<implantacao>/`) e ao seu wrapper CLI.
 *
 * Garantias técnicas do mecanismo:
 *   - Chave natural do upsert: (companyId, code). O code nunca é alterado.
 *   - Campos ADMINISTRADOS: name, description, isActive. Qualquer outro campo
 *     do WorkCenter (capacityHoursPerDay, costPerHour, operatorsCount,
 *     efficiencyPct, ...) NUNCA é gravado nem sobrescrito — na criação ficam
 *     nos defaults do schema.
 *   - Dry-run é decisão do chamador (apply=false): NENHUMA escrita acontece.
 *   - Escritas de apply rodam numa única transação.
 *   - Centro presente no banco e ausente do dataset: só relatado; nunca
 *     excluído (não existe caminho de delete); desativado apenas com
 *     deactivateMissing explícito, e só se estiver ativo.
 *   - Empresa resolvida por CNPJ em igualdade EXATA, recebido como argumento
 *     obrigatório; 0 ou >1 resultados abortam. companyId nunca vem do dataset.
 */

/** Estado final desejado de um centro de trabalho — contrato de entrada do núcleo. */
export interface DesiredWorkCenter {
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

/** Recorte de WorkCenter existente no banco que interessa à comparação. */
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
  /** No banco, mas fora do dataset — nunca excluídos. */
  missing: ExistingWorkCenter[];
  /** Ausentes que seriam desativados com deactivateMissing (só os ativos). */
  missingToDeactivate: ExistingWorkCenter[];
}

/**
 * Compara o estado desejado com os centros existentes e monta o plano.
 * Não escreve nada — quem decide aplicar é o chamador.
 */
export function planWorkCenterSync(
  desired: readonly DesiredWorkCenter[],
  existing: readonly ExistingWorkCenter[],
): SyncPlan {
  const codes = new Set<string>();
  for (const wc of desired) {
    if (codes.has(wc.code)) {
      throw new Error(`Dataset inválido: code duplicado "${wc.code}"`);
    }
    codes.add(wc.code);
  }

  const byCode = new Map(existing.map((wc) => [wc.code, wc]));
  const plan: SyncPlan = { create: [], update: [], unchanged: [], missing: [], missingToDeactivate: [] };

  for (const wc of desired) {
    const current = byCode.get(wc.code);
    if (!current) {
      plan.create.push(wc);
      continue;
    }
    const changes: UpdatePlanEntry['changes'] = {};
    if (current.name !== wc.name) changes.name = wc.name;
    if (current.description !== wc.description) changes.description = wc.description;
    if (current.isActive !== wc.isActive) changes.isActive = wc.isActive;

    if (Object.keys(changes).length > 0) {
      plan.update.push({ id: current.id, code: current.code, changes });
    } else {
      plan.unchanged.push(wc);
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
 * impossível hoje — a checagem fica mesmo assim, defensiva, para o caso de a
 * constraint mudar ou de a busca ser alterada no futuro.
 */
export function resolveTargetCompany(candidates: readonly CompanyCandidate[], cnpj: string): CompanyCandidate {
  if (candidates.length === 0) {
    throw new Error(
      `Nenhuma empresa encontrada com CNPJ exatamente igual a "${cnpj}". ` +
        'Confira o cadastro ou informe o CNPJ correto da empresa de destino.',
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
  $transaction<T>(
    fn: (tx: WorkCenterImportDb) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T>;
}

export interface ImportOptions {
  /** Sem apply, NENHUMA escrita acontece (dry-run). */
  apply: boolean;
  /** Só tem efeito junto com apply: desativa (nunca exclui) os ausentes. */
  deactivateMissing: boolean;
  /** CNPJ da empresa de destino (igualdade exata) — obrigatório, sem default. */
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
  desired: readonly DesiredWorkCenter[],
  options: ImportOptions,
): Promise<ImportResult> {
  if (!options.targetCnpj) {
    throw new Error('CNPJ da empresa de destino é obrigatório — o núcleo não tem empresa padrão.');
  }

  const candidates = await db.company.findMany({
    where: { cnpj: options.targetCnpj },
    select: { id: true, cnpj: true, name: true },
  });
  const company = resolveTargetCompany(candidates, options.targetCnpj);

  const existing = await db.workCenter.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true, name: true, description: true, isActive: true },
  });
  const plan = planWorkCenterSync(desired, existing);

  if (!options.apply) {
    return { company, plan, applied: false, created: 0, updated: 0, deactivated: 0 };
  }

  // 60s: o default de 5s do Prisma não comporta ~34 creates seriais via pooler
  // remoto (Supabase 6543) — a transação expirava no meio e revertia tudo.
  const { created, updated, deactivated } = await db.$transaction(async (tx) => {
    let createdCount = 0;
    let updatedCount = 0;
    let deactivatedCount = 0;

    for (const wc of plan.create) {
      // Só os campos administrados + companyId; os demais ficam nos defaults
      // do schema.
      await tx.workCenter.create({ data: { ...wc, companyId: company.id } });
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
  }, { timeout: 60_000 });

  return { company, plan, applied: true, created, updated, deactivated };
}
