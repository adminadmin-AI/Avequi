/**
 * Escrita do plano de importação — a ÚNICA porta de gravação de NF-e RECEBIDA.
 *
 * Usada pelo CLI dos XMLs locais hoje e pelo fluxo Focus (#608) depois: quem
 * tiver um XML (arquivo ou resposta da Focus) faz `planFromXml` e, autorizado,
 * `applyPlan`. Um documento = uma transação (doc + itens + impostos juntos ou
 * nada). Nunca cria Supplier; nunca reescreve itens/impostos existentes.
 */
import { ParsedFile, ImportContext, ImportPlan, buildTargetFromNfe, TargetDoc } from './received-nfe-import-core';
import { parseNfeDocument } from '../nfe-xml/nfe-proc.parser';

/** Subconjunto do PrismaClient usado aqui (facilita mock e evita acoplamento). */
export interface FiscalWriter {
  fiscalDocument: {
    create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  };
}

/**
 * Entrada para o fluxo Focus (PR Focus-B): um XML em texto + contexto → plano.
 * Mesmo parser, mesmo núcleo do CLI. Devolve `null` para eventos/desconhecidos
 * (o chamador decide o que fazer com eventos; ver planBatch para lotes).
 */
export function planFromXml(xml: string, ctx: ImportContext): ImportPlan | null {
  const doc = parseNfeDocument(xml);
  if (doc.kind !== 'NFE') return null;
  return buildTargetFromNfe(doc, ctx);
}

export function toCreateData(t: TargetDoc, xml: string): Record<string, unknown> {
  return {
    companyId: t.companyId,
    type: t.type,
    direction: t.direction,
    status: t.status,
    finalidade: t.finalidade,
    chave: t.chave,
    number: t.number,
    series: t.series,
    issueDate: t.issueDate,
    authorizedAt: t.authorizedAt,
    protocolNumber: t.protocolNumber,
    issuerCnpj: t.issuerCnpj,
    issuerName: t.issuerName,
    recipientCnpj: t.recipientCnpj,
    naturezaOperacao: t.naturezaOperacao,
    tpNF: t.tpNF,
    supplierId: t.supplierId,
    infCpl: t.infCpl,
    cancelledAt: t.cancelledAt,
    cancellationJustification: t.cancellationJustification,
    xml,
    ...t.totals,
    items: {
      create: t.items.map((it) => ({
        nItem: it.nItem,
        productCode: it.productCode,
        productName: it.productName,
        ncm: it.ncm,
        cest: it.cest,
        cfop: it.cfop,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        ...(it.tax ? { taxes: { create: [it.tax] } } : {}),
      })),
    },
  };
}

export function toUpdateData(plan: ImportPlan, xml: string): Record<string, unknown> {
  const u = plan.update!;
  const data: Record<string, unknown> = {};
  if (u.supplierId !== undefined) data.supplierId = u.supplierId;
  if (u.xml) data.xml = xml;
  if (u.cancel) {
    data.status = 'CANCELLED';
    data.cancelledAt = u.cancel.cancelledAt;
    data.cancellationJustification = u.cancel.justification;
  }
  return data;
}

/**
 * Aplica UM plano (INSERT ou UPDATE). O chamador envolve em transação
 * (`prisma.$transaction(async tx => applyPlan(tx, …))`); a criação aninhada
 * de itens/impostos já é atômica dentro do mesmo statement do Prisma.
 */
export async function applyPlan(tx: FiscalWriter, plan: ImportPlan, xml: string): Promise<{ id: string; action: 'INSERT' | 'UPDATE' }> {
  if (plan.state === 'INSERT' && plan.target) {
    const r = await tx.fiscalDocument.create({ data: toCreateData(plan.target, xml), select: { id: true } });
    return { id: r.id, action: 'INSERT' };
  }
  if (plan.state === 'UPDATE' && plan.update) {
    const r = await tx.fiscalDocument.update({ where: { id: plan.update.docId }, data: toUpdateData(plan, xml), select: { id: true } });
    return { id: r.id, action: 'UPDATE' };
  }
  throw new Error(`applyPlan: plano ${plan.chave} em estado ${plan.state} não é executável`);
}

/** Lê um arquivo já carregado em memória para o formato do lote. */
export function parseFileContent(path: string, xml: string): ParsedFile {
  try {
    return { path, doc: parseNfeDocument(xml), error: null };
  } catch (err) {
    return { path, doc: null, error: (err as Error).message };
  }
}
