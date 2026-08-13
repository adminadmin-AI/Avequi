import { Injectable, Logger } from '@nestjs/common';
import { EmissionResponse, EmissorPort, NfseEmissionResponse } from './emissor.port';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

// Compat: o shape da resposta agora vive no contrato EmissorPort (#501)
export type FocusEmissionResponse = EmissionResponse;

@Injectable()
export class FiscalClientService implements EmissorPort {
  private readonly logger = new Logger(FiscalClientService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('FOCUS_NFE_BASE_URL', 'https://homologacao.focusnfe.com.br');
  }

  /**
   * #695 — multi-emissor: na conta Focus reestruturada cada CNPJ (matriz,
   * loja Guarapuava, CRD) tem token próprio. Resolução por env indexada
   * `FOCUS_NFE_TOKEN__<companyId>` com fallback no token global (matriz).
   * Env em vez de banco: token é secret e já vive no Railway; company nova
   * emitindo = 1 env + redeploy (evento raro), sem criptografia própria.
   */
  private tokenFor(companyId?: string): string {
    if (companyId) {
      const scoped = this.config.get<string>(`FOCUS_NFE_TOKEN__${companyId}`, '');
      if (scoped) return scoped;
    }
    return this.config.get<string>('FOCUS_NFE_TOKEN', '');
  }

  /** S08.03: enviar NFC-e para Focus NFe */
  async emitNFCe(ref: string, payload: Record<string, unknown>, companyId?: string): Promise<FocusEmissionResponse> {
    return this.post(`/v2/nfce?ref=${ref}`, payload, companyId);
  }

  /** S08.03: enviar NF-e para Focus NFe */
  async emitNFe(ref: string, payload: Record<string, unknown>, companyId?: string): Promise<FocusEmissionResponse> {
    return this.post(`/v2/nfe?ref=${ref}`, payload, companyId);
  }

  /** Cancelar NF-e/NFC-e na SEFAZ via Focus NFe */
  async cancelNFe(ref: string, justificativa: string, companyId?: string): Promise<FocusEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.delete<FocusEmissionResponse>(`${this.baseUrl}/v2/nfe/${ref}`, {
          auth: { username: this.tokenFor(companyId), password: '' },
          data: { justificativa },
        }),
      );
      this.logger.log(`Focus NFe cancel response: status=${data.status} ref=${ref}`);
      return data;
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** CC-e (Carta de Correção) via Focus NFe */
  async sendCCe(ref: string, correcao: string, companyId?: string): Promise<FocusEmissionResponse> {
    return this.post(`/v2/nfe/${ref}/carta_correcao`, { correcao }, companyId);
  }

  /** Inutilização de faixa de numeração via Focus NFe */
  async voidRange(payload: {
    cnpj: string;
    serie: string;
    numero_inicial: number;
    numero_final: number;
    justificativa: string;
  }, companyId?: string): Promise<FocusEmissionResponse> {
    return this.post('/v2/nfe/inutilizacao', payload, companyId);
  }

  /** Buscar NF-e recebidas (destinadas ao CNPJ) via Focus NFe */
  async fetchReceivedNfes(cnpj: string, companyId?: string): Promise<any[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<any[]>(`${this.baseUrl}/v2/nfes_recebidas?cnpj=${cnpj}`, {
          auth: { username: this.tokenFor(companyId), password: '' },
        }),
      );
      this.logger.log(`Focus NFe: ${Array.isArray(data) ? data.length : 0} NF-e recebidas para CNPJ ${cnpj}`);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      this.logger.error(`Erro ao buscar NF-e recebidas: ${axiosErr.message}`);
      return [];
    }
  }

  /** Manifestar NF-e recebida (ciência, confirmação, rejeição, desconhecimento) */
  async manifestNfe(
    chaveNfe: string,
    tipoEvento: number,
    justificativa?: string,
    companyId?: string,
  ): Promise<FocusEmissionResponse & { protocolo?: string }> {
    try {
      const payload: Record<string, unknown> = { tipo: tipoEvento };
      if (justificativa) {
        payload.justificativa = justificativa;
      }

      const { data } = await firstValueFrom(
        this.http.post<FocusEmissionResponse & { protocolo?: string }>(
          `${this.baseUrl}/v2/nfes_recebidas/${chaveNfe}/manifesto`,
          payload,
          { auth: { username: this.tokenFor(companyId), password: '' } },
        ),
      );

      this.logger.log(`Focus NFe manifest: chave=${chaveNfe} tipo=${tipoEvento} status=${data.status}`);
      return data;
    } catch (err) {
      const result = this.handleError(err);
      return { ...result, protocolo: undefined };
    }
  }

  /** Transforma um caminho relativo da Focus (caminho_danfe etc.) em URL absoluta */
  absoluteUrl(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  /**
   * Baixa um arquivo servido pela Focus (XML/DANFE) — aceita caminho relativo
   * ou URL absoluta. Retorna null em erro (não lança). (#482)
   */
  async downloadFile(path: string, companyId?: string): Promise<string | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<string>(this.absoluteUrl(path), {
          auth: { username: this.tokenFor(companyId), password: '' },
          responseType: 'text',
          // impede o axios de tentar parsear o XML como JSON
          transformResponse: [(d) => d],
        }),
      );
      return typeof data === 'string' && data.length > 0 ? data : null;
    } catch (err) {
      const axiosErr = err as AxiosError;
      this.logger.error(`Erro ao baixar arquivo da Focus (${path}): ${axiosErr.message}`);
      return null;
    }
  }

  /** Consultar status de um documento já enviado */
  async getStatus(type: 'nfe' | 'nfce', ref: string, companyId?: string): Promise<FocusEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<FocusEmissionResponse>(`${this.baseUrl}/v2/${type}/${ref}`, {
          auth: { username: this.tokenFor(companyId), password: '' },
        }),
      );
      return data;
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ── NFS-e Nacional (#1077) ───────────────────────────────────────────────
  // São José dos Pinhais aderiu ao ambiente nacional (obrigatório desde
  // 01/01/2026), então é `/v2/nfsen` — layout único, não o padrão municipal
  // antigo do ISSonline. Mesma conta e mesmo tokenFor(companyId) da NF-e.

  /** Emitir NFS-e Nacional — envia a DPS, recebe a NFS-e */
  async emitNFSe(ref: string, payload: Record<string, unknown>, companyId?: string): Promise<NfseEmissionResponse> {
    const data = await this.post(`/v2/nfsen?ref=${ref}`, payload, companyId);
    return this.normalizeNfse(data);
  }

  /**
   * Cancelar NFS-e Nacional.
   *
   * ⚠️ Diferente da NF-e: o município processa de forma ASSÍNCRONA e não
   * aprova na hora. Resposta "não processado" significa pendente no município,
   * não falha — reenviar o cancelamento faz a Focus reconsultar. Quem chamar
   * isto precisa tratar o estado intermediário em vez de dar erro ao usuário.
   */
  async cancelNFSe(ref: string, justificativa: string, companyId?: string): Promise<NfseEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.delete<NfseEmissionResponse>(`${this.baseUrl}/v2/nfsen/${ref}`, {
          auth: { username: this.tokenFor(companyId), password: '' },
          data: { justificativa },
        }),
      );
      this.logger.log(`Focus NFS-e cancel: status=${data.status} ref=${ref}`);
      return this.normalizeNfse(data);
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Consultar status de NFS-e já enviada */
  async getNfseStatus(ref: string, companyId?: string): Promise<NfseEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<NfseEmissionResponse>(`${this.baseUrl}/v2/nfsen/${ref}`, {
          auth: { username: this.tokenFor(companyId), password: '' },
        }),
      );
      return this.normalizeNfse(data);
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * Normaliza a resposta de NFS-e.
   *
   * A doc aberta da Focus publica os campos da REQUISIÇÃO, mas não os da
   * RESPOSTA do `/v2/nfsen`. Em vez de fixar um nome só e quebrar se vier
   * outro, aceitamos os apelidos plausíveis da convenção da casa e expomos um
   * shape estável para o domínio. A 1ª emissão em homologação confirma quais
   * chegam de verdade — aí dá para enxugar isto com evidência em vez de
   * palpite.
   */
  private normalizeNfse(data: any): NfseEmissionResponse {
    if (!data || typeof data !== 'object') return data;
    return {
      ...data,
      numero_nfse: data.numero_nfse ?? data.numero ?? undefined,
      chave_acesso: data.chave_acesso ?? data.chave ?? data.chave_nfse ?? data.chave_nfe ?? undefined,
      caminho_danfse: data.caminho_danfse ?? data.caminho_danfe ?? data.caminho_pdf ?? undefined,
      caminho_xml_nota_fiscal: data.caminho_xml_nota_fiscal ?? data.caminho_xml ?? undefined,
    };
  }

  private async post(path: string, payload: Record<string, unknown>, companyId?: string): Promise<FocusEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.post<FocusEmissionResponse>(`${this.baseUrl}${path}`, payload, {
          auth: { username: this.tokenFor(companyId), password: '' },
        }),
      );
      this.logger.log(`Focus NFe response: status=${data.status} chave=${data.chave_nfe ?? 'N/A'}`);
      return data;
    } catch (err) {
      return this.handleError(err);
    }
  }

  private handleError(err: unknown): FocusEmissionResponse {
    const axiosErr = err as AxiosError<any>;
    const data = axiosErr.response?.data;
    this.logger.error(`Focus NFe error: ${axiosErr.message}`, data);
    return {
      status: 'erro',
      motivo: data?.mensagem ?? data?.message ?? axiosErr.message ?? 'Erro de comunicação com Focus NFe',
      codigo: String(axiosErr.response?.status ?? 0),
    };
  }
}
