import { Injectable, Logger } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import {
  RenavePort,
  RenaveSaleInput,
  VehicleProviderResponse,
} from '../ports/vehicle-provider.port';
import { buildSerproClient, sanitizeProviderResponse } from './serpro-http';

/**
 * Adapter SERPRO do RENAVE-WS 0km — venda direta pela montadora (#530/#531).
 *
 * Paths conforme o manual público (renave.estaleiro.serpro.gov.br/renave-ws/manual):
 * entrar-estoque-zero-km · sair-estoque-zero-km-pela-montadora · obter-pdf-atpv ·
 * cancelar-saida-estoque-zero-km · devolver-montadora-veiculo-zero-km.
 * ⚠️ Confirmar paths/payloads exatos no primeiro acesso à homologação (#528) —
 * único arquivo a ajustar; domínio/fila não mudam (port #501).
 */
@Injectable()
export class SerproRenaveAdapter implements RenavePort {
  private readonly logger = new Logger(SerproRenaveAdapter.name);
  private client: AxiosInstance | null = null;

  private http(): AxiosInstance {
    if (!this.client) {
      const baseURL =
        process.env.RENAVE_WS_BASE_URL ??
        'https://hom.renave.estaleiro.serpro.gov.br';
      this.client = buildSerproClient(baseURL);
    }
    return this.client;
  }

  async entrarEstoque(chassi: string): Promise<VehicleProviderResponse> {
    return this.call('post', '/renave-ws/api/estoque/entrar-estoque-zero-km', { chassi });
  }

  async sairEstoque(input: RenaveSaleInput): Promise<VehicleProviderResponse> {
    return this.call('post', '/renave-ws/api/estoque/sair-estoque-zero-km-pela-montadora', {
      chassi: input.chassi,
      chaveNotaFiscal: input.chaveNfe,
      cpfCnpjComprador: input.clienteCpfCnpj,
      nomeComprador: input.clienteNome,
      ...(input.clienteEmail && { emailComprador: input.clienteEmail }),
    });
  }

  async obterPdfAtpv(
    chassi: string,
    chaveNfe: string,
  ): Promise<VehicleProviderResponse & { pdfBase64?: string }> {
    const res = await this.call('get', `/renave-ws/api/atpv/obter-pdf-atpv`, {
      params: { chassi, chaveNotaFiscal: chaveNfe },
    });
    if (res.status !== 'ok') return res;
    const pdfBase64 = (res.raw?.pdf ?? res.raw?.pdfBase64 ?? res.raw?.arquivo) as
      | string
      | undefined;
    if (!pdfBase64) {
      return { status: 'erro', motivo: 'Retorno sem PDF (campo pdf/pdfBase64/arquivo ausente)', raw: res.raw };
    }
    // o binário não vai pro ledger (rawResponse) — só metadados
    const { pdf, pdfBase64: _b64, arquivo, ...rawMeta } = res.raw as Record<string, unknown>;
    return { ...res, raw: rawMeta, pdfBase64 };
  }

  async cancelarSaida(chassi: string, motivo: string): Promise<VehicleProviderResponse> {
    return this.call('post', '/renave-ws/api/estoque/cancelar-saida-estoque-zero-km', {
      chassi,
      motivo,
    });
  }

  async devolverMontadora(
    chassi: string,
    chaveNfeDevolucao: string,
  ): Promise<VehicleProviderResponse> {
    return this.call('post', '/renave-ws/api/estoque/devolver-montadora-veiculo-zero-km', {
      chassi,
      chaveNotaFiscalDevolucao: chaveNfeDevolucao,
    });
  }

  private async call(
    method: 'get' | 'post',
    path: string,
    bodyOrConfig?: Record<string, unknown>,
  ): Promise<VehicleProviderResponse> {
    try {
      const res =
        method === 'get'
          ? await this.http().get(path, bodyOrConfig as object)
          : await this.http().post(path, bodyOrConfig);
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
        protocol: (res.data?.protocolo ?? res.data?.idIntencaoVenda ?? res.data?.id ?? null) as
          | string
          | undefined,
        raw,
      };
    } catch (err) {
      const motivo = (err as Error).message;
      this.logger.warn(`RENAVE ${method.toUpperCase()} ${path}: ${motivo}`);
      return { status: 'erro', motivo };
    }
  }
}
