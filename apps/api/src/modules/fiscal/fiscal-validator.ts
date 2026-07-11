/**
 * Fiscal Validator (#499, auditoria item 2) — validação estruturada do payload
 * ANTES da transmissão à Focus/SEFAZ.
 *
 * Cada regra simula uma rejeição real que já nos custou ciclo de homologação
 * (535, 728, 871, 1033, 234...) e devolve mensagem orientada à correção, em vez
 * de deixar a SEFAZ descobrir tarde. Opera sobre o payload FLAT da Focus — o
 * mesmo objeto que buildNFePayload/buildTransferNFePayload produzem — então
 * vale para qualquer caminho de emissão.
 *
 * Regras aqui são estruturais/documentadas; adequação tributária (qual CST/CFOP
 * usar) continua sendo papel das TaxRules (#498).
 */

export interface ValidationIssue {
  /** Código da rejeição SEFAZ que a regra previne (ou COD interno p/ lição Focus) */
  rejection: string;
  field: string;
  message: string;
}

type Payload = Record<string, any>;

/**
 * Limite p/ NFC-e SEM identificação do consumidor (regra W16-40, NT 2026.002
 * fase 1 — EM PRODUÇÃO na SEFAZ desde 15/06/2026). Default nacional R$ 10.000;
 * cada UF pode definir o seu → ajustável por env NFCE_UNIDENTIFIED_LIMIT.
 */
export function nfceUnidentifiedLimit(): number {
  const raw = Number(process.env.NFCE_UNIDENTIFIED_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 10000;
}

export function validateNfePayload(
  payload: Payload,
  model: 'nfe' | 'nfce' = 'nfe',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const items: Payload[] = Array.isArray(payload.items) ? payload.items : [];

  // ── W16-40 (NT 2026.002): NFC-e acima do limite exige identificação ───────
  // Consumidor não identificado é válido SÓ até o limite da UF (default 10k).
  // Acima disso a SEFAZ rejeita — bloquear aqui evita queimar a ref na Focus
  // e devolve orientação acionável pro balcão (identificar o cliente).
  if (model === 'nfce') {
    const total = items.reduce((sum, i) => sum + (Number(i.valor_total_bruto) || 0), 0);
    const hasDest =
      digits(payload.cpf_destinatario).length === 11 ||
      digits(payload.cnpj_destinatario).length === 14;
    const limit = nfceUnidentifiedLimit();
    if (total > limit && !hasDest) {
      issues.push({
        rejection: 'W16-40',
        field: 'cpf_destinatario',
        message:
          `NFC-e de R$ ${total.toFixed(2)} sem identificação do consumidor — acima de ` +
          `R$ ${limit.toFixed(2)} a SEFAZ exige CPF/CNPJ do destinatário (NT 2026.002). ` +
          'Identifique o cliente na venda (ou emita NF-e com cadastro completo).',
      });
    }
  }

  // ── data_emissao: obrigatória e com fuso explícito ≠ UTC ──────────────────
  // Nota emitida após 21h em UTC "pula" de dia → SEFAZ 577 bloqueia cancelamento
  const dataEmissao = String(payload.data_emissao ?? '');
  if (!dataEmissao) {
    issues.push({
      rejection: '509',
      field: 'data_emissao',
      message: 'data_emissao ausente — a Focus exige data de emissão explícita.',
    });
  } else if (dataEmissao.endsWith('Z') || !/[+-]\d{2}:\d{2}$/.test(dataEmissao)) {
    issues.push({
      rejection: '577',
      field: 'data_emissao',
      message:
        `data_emissao "${dataEmissao}" sem offset de fuso (-03:00) — em UTC a nota emitida após 21h ` +
        'pula de dia e a SEFAZ bloqueia o cancelamento (rej. 577).',
    });
  }

  // ── CNPJ/CPF: dígitos verificadores ────────────────────────────────────────
  const cnpjEmitente = digits(payload.cnpj_emitente);
  if (cnpjEmitente && !isValidCnpj(cnpjEmitente)) {
    issues.push({
      rejection: '207',
      field: 'cnpj_emitente',
      message: `CNPJ do emitente inválido (dígito verificador): ${payload.cnpj_emitente}`,
    });
  }
  const cnpjDest = digits(payload.cnpj_destinatario);
  if (cnpjDest && !isValidCnpj(cnpjDest)) {
    issues.push({
      rejection: '209',
      field: 'cnpj_destinatario',
      message: `CNPJ do destinatário inválido (dígito verificador): ${payload.cnpj_destinatario}`,
    });
  }
  const cpfDest = digits(payload.cpf_destinatario);
  if (cpfDest && !isValidCpf(cpfDest)) {
    issues.push({
      rejection: '209',
      field: 'cpf_destinatario',
      message: `CPF do destinatário inválido (dígito verificador): ${payload.cpf_destinatario}`,
    });
  }

  // ── IE do destinatário ─────────────────────────────────────────────────────
  const ie = String(payload.inscricao_estadual_destinatario ?? '').trim().toUpperCase();
  const indIeDest = String(payload.indicador_inscricao_estadual_destinatario ?? '');
  if (ie === 'ISENTO') {
    // Rejeição 728: IE "ISENTO" não pode ser enviada — usa-se indicador 2 e omite a IE
    issues.push({
      rejection: '728',
      field: 'inscricao_estadual_destinatario',
      message:
        'IE "ISENTO" não deve ser enviada — use indicador_inscricao_estadual_destinatario=2 e omita a IE (rej. 728).',
    });
  }
  if (indIeDest === '1' && !ie) {
    issues.push({
      rejection: '234',
      field: 'inscricao_estadual_destinatario',
      message:
        'Destinatário marcado como contribuinte (indIEDest=1) sem IE informada (rej. 234). ' +
        'Informe a IE real ou ajuste o indicador do cliente.',
    });
  }

  // ── Devolução (finNFe 4): pagamento obrigatório "90 - Sem pagamento" ───────
  if (String(payload.finalidade_emissao ?? '') === '4') {
    const pags: Payload[] = Array.isArray(payload.formas_pagamento) ? payload.formas_pagamento : [];
    const ok =
      pags.length > 0 &&
      pags.every((p) => String(p.forma_pagamento) === '90' && Number(p.valor_pagamento ?? p.valor ?? 0) === 0);
    if (!ok) {
      issues.push({
        rejection: '871',
        field: 'formas_pagamento',
        message:
          'NF-e de devolução (finalidade 4) exige forma_pagamento "90 - Sem pagamento" com valor 0 (rej. 871).',
      });
    }
  }

  // ── Frete: vFrete é RATEADO POR ITEM, nunca no cabeçalho ───────────────────
  if (payload.valor_frete != null && Number(payload.valor_frete) > 0) {
    issues.push({
      rejection: '535',
      field: 'valor_frete',
      message:
        'valor_frete no cabeçalho — o vFrete deve ser rateado por item (rej. 535). ' +
        'O mapper usa allocateFreight(); remova o total do cabeçalho.',
    });
  }

  // ── Itens ──────────────────────────────────────────────────────────────────
  items.forEach((item, idx) => {
    const n = item.numero_item ?? idx + 1;
    const ncm = String(item.codigo_ncm ?? '');
    if (!/^\d{8}$/.test(ncm)) {
      issues.push({
        rejection: '778',
        field: `items[${n}].codigo_ncm`,
        message: `NCM "${ncm}" inválido — deve ter 8 dígitos (rej. 778).`,
      });
    }
    if (ncm === '00000000') {
      issues.push({
        rejection: '778',
        field: `items[${n}].codigo_ncm`,
        message: `Item ${n} sem NCM classificado (placeholder 00000000) — classifique o produto antes de emitir.`,
      });
    }
    const cfop = String(item.cfop ?? '');
    if (!/^[1-7]\d{3}$/.test(cfop)) {
      issues.push({
        rejection: '511',
        field: `items[${n}].cfop`,
        message: `CFOP "${cfop}" inválido — 4 dígitos iniciando em 1-7 (rej. 511).`,
      });
    }

    // gRed (#446): CST IBS/CBS 2xx exige percentual de redução + alíquota efetiva
    const cstIbsCbs = String(item.ibs_cbs_situacao_tributaria ?? '');
    if (/^2\d\d$/.test(cstIbsCbs)) {
      const temGRed =
        item.cbs_percentual_reducao_aliquota != null &&
        item.ibs_uf_percentual_reducao_aliquota != null;
      if (!temGRed) {
        issues.push({
          rejection: '1033',
          field: `items[${n}].ibs_cbs_situacao_tributaria`,
          message:
            `CST IBS/CBS ${cstIbsCbs} exige grupo gRed (percentual_reducao_aliquota + aliquota_efetiva) (rej. 1033). ` +
            'Confira percRedIbs/percRedCbs da classificação tributária.',
        });
      }
    }

    // Veículo: campos que a Focus IGNORA EM SILÊNCIO se ausentes/errados (#435/#441)
    if (item.veiculo_codigo_vin || item.veiculo_chassi) {
      if (item.veiculo_cmt == null || item.veiculo_distancia_eixos == null) {
        issues.push({
          rejection: 'FOCUS-VEIC',
          field: `items[${n}].veiculo_cmt`,
          message:
            `Item ${n} com grupo veículo sem veiculo_cmt/veiculo_distancia_eixos — ` +
            'obrigatórios no veicProd; sem eles a nota autoriza SEM os dados de emplacamento.',
        });
      }
      const serie = String(item.veiculo_serie ?? '');
      if (serie.length > 9) {
        issues.push({
          rejection: 'FOCUS-VEIC',
          field: `items[${n}].veiculo_serie`,
          message: `veiculo_serie "${serie}" com ${serie.length} chars — máximo 9 (nSerie).`,
        });
      }
    }
  });

  return issues;
}

/** Mensagem única e orientada para lastError/log a partir dos issues */
export function formatValidationIssues(issues: ValidationIssue[]): string {
  return (
    `Validação pré-transmissão bloqueou a emissão (${issues.length} problema${issues.length > 1 ? 's' : ''}): ` +
    issues.map((i) => `[${i.rejection}] ${i.message}`).join(' | ')
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}
