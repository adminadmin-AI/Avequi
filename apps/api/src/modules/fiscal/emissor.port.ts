/**
 * EmissorPort (#501, auditoria item 4) — contrato de emissão fiscal do domínio.
 *
 * O domínio (FiscalService, ManifestService...) depende desta interface, não da
 * Focus. Trocar de emissor (outro gateway, SEFAZ direto, mock de teste) vira
 * escrever outro adapter e apontar o provider EMISSOR_PORT no FiscalModule —
 * zero mudança no domínio.
 *
 * A semântica de erro faz parte do contrato: falha de comunicação NÃO lança —
 * resolve com `{ status: 'erro', motivo, codigo }` (o domínio decide o que
 * fazer; listeners nunca desfazem a venda por falha fiscal).
 */

export interface EmissionResponse {
  status: 'autorizado' | 'processando_autorizacao' | 'rejeitado' | 'cancelado' | 'erro';
  chave_nfe?: string;
  xml?: string;
  motivo?: string;
  codigo?: string;
  ref?: string;
  numero?: string | number;
  serie?: string | number;
  protocolo?: string;
  caminho_xml_nota_fiscal?: string; // path relativo do XML autorizado (#482)
  caminho_danfe?: string; // path relativo do PDF do DANFE (#482)
}

/** Token de injeção do adapter de emissão (FiscalModule provê FocusNFe hoje) */
export const EMISSOR_PORT = Symbol('EMISSOR_PORT');

export interface EmissorPort {
  /** Emitir NF-e (modelo 55) */
  emitNFe(ref: string, payload: Record<string, unknown>, companyId?: string): Promise<EmissionResponse>;

  /** Emitir NFC-e (modelo 65) */
  emitNFCe(ref: string, payload: Record<string, unknown>, companyId?: string): Promise<EmissionResponse>;

  /** Cancelar NF-e/NFC-e autorizada (prazo SEFAZ 24h) */
  cancelNFe(ref: string, justificativa: string, companyId?: string): Promise<EmissionResponse>;

  /** Carta de Correção eletrônica */
  sendCCe(ref: string, correcao: string, companyId?: string): Promise<EmissionResponse>;

  /** Inutilização de faixa de numeração */
  voidRange(payload: {
    cnpj: string;
    serie: string;
    numero_inicial: number;
    numero_final: number;
    justificativa: string;
  }, companyId?: string): Promise<EmissionResponse>;

  /** NF-e destinadas ao CNPJ (entrada) — lista vazia em erro */
  fetchReceivedNfes(cnpj: string, companyId?: string): Promise<any[]>;

  /** Manifestação do destinatário (ciência/confirmação/rejeição/desconhecimento) */
  manifestNfe(
    chaveNfe: string,
    tipoEvento: number,
    justificativa?: string,
    companyId?: string,
  ): Promise<EmissionResponse & { protocolo?: string }>;

  /** Caminho relativo do emissor → URL absoluta (XML/DANFE) */
  absoluteUrl(path: string): string;

  /** Baixa XML/DANFE — null em erro, não lança (#482) */
  downloadFile(path: string, companyId?: string): Promise<string | null>;

  /** Consulta de status de documento já enviado */
  getStatus(type: 'nfe' | 'nfce', ref: string, companyId?: string): Promise<EmissionResponse>;
}
