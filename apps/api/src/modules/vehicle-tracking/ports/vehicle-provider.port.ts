/**
 * Ports da integração veicular (#529/#530) — contratos do domínio com os
 * providers externos (SERPRO Pré-Cadastro BIN e RENAVE-WS), no mesmo desenho
 * do EmissorPort (#501): o domínio depende da interface; trocar de provider
 * (outro gateway, mock de homologação) é escrever outro adapter e apontar o
 * provider do token — zero mudança em orchestrator/processor.
 *
 * Semântica de erro (parte do contrato, igual EmissorPort): falha de
 * comunicação NÃO lança — resolve `{ status: 'erro', motivo }`. Quem decide o
 * que fazer é o processor (marca ERROR + relança p/ retry do Bull); listeners
 * nunca desfazem venda/devolução por falha externa (#532).
 */

export interface VehicleProviderResponse {
  status: 'ok' | 'processando' | 'erro';
  /** protocolo/id devolvido pelo provider (rastreio no ledger) */
  protocol?: string;
  motivo?: string;
  codigo?: string;
  /** retorno bruto JÁ SANITIZADO (sem CPF/CNPJ em claro, sem token/cert — LGPD #527) */
  raw?: Record<string, unknown>;
}

/** Dados do chassi para o pré-cadastro BIN (tela 3270 → WS, manual RENAVAM-DU) */
export interface BinVehicleInput {
  chassi: string;
  condicaoChassi?: string | null;
  ufFaturamento: string;
  /** código marca/modelo RENAVAM (6 díg. — ex.: 600657 Carresul) */
  codigoMarcaModelo: string;
  corDenatran?: string | null;
  qtdEixos?: number | null;
  anoFabricacao: number;
  anoModelo: number;
  /** espécie 2 (carga) / tipo 10 (reboque) / carroceria 107 — defaults GDR (#529) */
  especieVeiculo?: string | null;
  tipoVeiculo?: string | null;
  tipoCarroceria?: string | null;
  cmt?: string | null;
  pesoBrutoTotal?: string | null;
  capacidadeCarga?: string | null;
}

export const BIN_PORT = Symbol('BIN_PORT');

export interface BinPort {
  /** Inclusão do pré-cadastro (cód 1) */
  registerVehicle(input: BinVehicleInput): Promise<VehicleProviderResponse>;
  /** Alteração do pré-cadastro (cód 2) */
  updateVehicle(input: BinVehicleInput): Promise<VehicleProviderResponse>;
  /** Exclusão do pré-cadastro (cód 3) */
  removeVehicle(chassi: string): Promise<VehicleProviderResponse>;
  /** Consulta por VIN — `status: 'ok'` quando o chassi consta na BIN */
  consultByVin(chassi: string): Promise<VehicleProviderResponse>;
}

export interface RenaveSaleInput {
  chassi: string;
  /** chave de acesso da NF-e da venda (44 díg.) */
  chaveNfe: string;
  clienteCpfCnpj: string;
  clienteNome: string;
  clienteEmail?: string | null;
}

export const RENAVE_PORT = Symbol('RENAVE_PORT');

export interface RenavePort {
  /** entrar-estoque-zero-km — gatilho: BIN REGISTERED (#530) */
  entrarEstoque(chassi: string): Promise<VehicleProviderResponse>;
  /** sair-estoque-zero-km-pela-montadora — gera intenção de venda sistêmica (ATPV-e) */
  sairEstoque(input: RenaveSaleInput): Promise<VehicleProviderResponse>;
  /** obter-pdf-atpv — devolve o binário do PDF em base64 */
  obterPdfAtpv(chassi: string, chaveNfe: string): Promise<VehicleProviderResponse & { pdfBase64?: string }>;
  /** cancelar-saida-estoque-zero-km — devolução antes de emplacar (cenário A, #531) */
  cancelarSaida(chassi: string, motivo: string): Promise<VehicleProviderResponse>;
  /** devolver-montadora-veiculo-zero-km — exige chave da NF-e de DEVOLUÇÃO (cenário B, #531) */
  devolverMontadora(chassi: string, chaveNfeDevolucao: string): Promise<VehicleProviderResponse>;
}
