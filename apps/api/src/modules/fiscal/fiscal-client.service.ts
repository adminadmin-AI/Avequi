import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface FocusEmissionResponse {
  status: 'autorizado' | 'processando_autorizacao' | 'rejeitado' | 'cancelado' | 'erro';
  chave_nfe?: string;
  xml?: string;
  motivo?: string;
  codigo?: string;
  ref?: string;
}

@Injectable()
export class FiscalClientService {
  private readonly logger = new Logger(FiscalClientService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('FOCUS_NFE_BASE_URL', 'https://homologacao.focusnfe.com.br');
    this.token = this.config.get<string>('FOCUS_NFE_TOKEN', '');
  }

  /** S08.03: enviar NFC-e para Focus NFe */
  async emitNFCe(ref: string, payload: Record<string, unknown>): Promise<FocusEmissionResponse> {
    return this.post(`/v2/nfce?ref=${ref}`, payload);
  }

  /** S08.03: enviar NF-e para Focus NFe */
  async emitNFe(ref: string, payload: Record<string, unknown>): Promise<FocusEmissionResponse> {
    return this.post(`/v2/nfe?ref=${ref}`, payload);
  }

  /** Cancelar NF-e/NFC-e na SEFAZ via Focus NFe */
  async cancelNFe(ref: string, justificativa: string): Promise<FocusEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.delete<FocusEmissionResponse>(`${this.baseUrl}/v2/nfe/${ref}`, {
          auth: { username: this.token, password: '' },
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
  async sendCCe(ref: string, correcao: string): Promise<FocusEmissionResponse> {
    return this.post(`/v2/nfe/${ref}/carta_correcao`, { correcao });
  }

  /** Inutilização de faixa de numeração via Focus NFe */
  async voidRange(payload: {
    cnpj: string;
    serie: string;
    numero_inicial: number;
    numero_final: number;
    justificativa: string;
  }): Promise<FocusEmissionResponse> {
    return this.post('/v2/nfe/inutilizacao', payload);
  }

  /** Consultar status de um documento já enviado */
  async getStatus(type: 'nfe' | 'nfce', ref: string): Promise<FocusEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<FocusEmissionResponse>(`${this.baseUrl}/v2/${type}/${ref}`, {
          auth: { username: this.token, password: '' },
        }),
      );
      return data;
    } catch (err) {
      return this.handleError(err);
    }
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<FocusEmissionResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.post<FocusEmissionResponse>(`${this.baseUrl}${path}`, payload, {
          auth: { username: this.token, password: '' },
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
