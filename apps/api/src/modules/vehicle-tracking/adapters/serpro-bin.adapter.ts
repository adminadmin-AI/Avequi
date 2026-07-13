import { Injectable, Logger } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import {
  BinPort,
  BinVehicleInput,
  VehicleProviderResponse,
} from '../ports/vehicle-provider.port';
import { buildSerproClient, sanitizeProviderResponse } from './serpro-http';

/**
 * Adapter SERPRO do Pré-Cadastro Veicular BIN (#529).
 *
 * ⚠️ Os paths abaixo seguem o manual público (RENAVAM-DU, WS/lote) e DEVEM ser
 * confirmados no primeiro acesso ao ambiente de homologação — o manual
 * completo do WS só é entregue após o credenciamento SENATRAN (#528). Este é
 * o ÚNICO arquivo a ajustar nesse momento; domínio/fila não mudam (port #501).
 */
@Injectable()
export class SerproBinAdapter implements BinPort {
  private readonly logger = new Logger(SerproBinAdapter.name);
  private client: AxiosInstance | null = null;

  private http(): AxiosInstance {
    if (!this.client) {
      const baseURL =
        process.env.BIN_WS_BASE_URL ??
        'https://hom.precadastro.estaleiro.serpro.gov.br';
      this.client = buildSerproClient(baseURL);
    }
    return this.client;
  }

  async registerVehicle(input: BinVehicleInput): Promise<VehicleProviderResponse> {
    return this.call('post', '/precadastro/v1/veiculo', { ...input, codigoOperacao: 1 });
  }

  async updateVehicle(input: BinVehicleInput): Promise<VehicleProviderResponse> {
    return this.call('post', '/precadastro/v1/veiculo', { ...input, codigoOperacao: 2 });
  }

  async removeVehicle(chassi: string): Promise<VehicleProviderResponse> {
    return this.call('post', '/precadastro/v1/veiculo', { chassi, codigoOperacao: 3 });
  }

  async consultByVin(chassi: string): Promise<VehicleProviderResponse> {
    return this.call('get', `/precadastro/v1/veiculo/${encodeURIComponent(chassi)}`);
  }

  private async call(
    method: 'get' | 'post',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<VehicleProviderResponse> {
    try {
      const res =
        method === 'get' ? await this.http().get(path) : await this.http().post(path, body);
      const raw = sanitizeProviderResponse(res.data);
      if (res.status >= 400) {
        return {
          status: 'erro',
          codigo: String(res.status),
          motivo: (res.data?.mensagem ?? res.data?.message ?? `HTTP ${res.status}`) as string,
          raw,
        };
      }
      return {
        status: 'ok',
        protocol: (res.data?.protocolo ?? res.data?.id ?? null) as string | undefined,
        raw,
      };
    } catch (err) {
      // contrato do port: falha de comunicação resolve 'erro', nunca lança
      const motivo = (err as Error).message;
      this.logger.warn(`BIN ${method.toUpperCase()} ${path}: ${motivo}`);
      return { status: 'erro', motivo };
    }
  }
}
