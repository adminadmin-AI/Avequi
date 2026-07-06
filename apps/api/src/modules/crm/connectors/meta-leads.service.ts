import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadSource } from '@prisma/client';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { LeadIntakeService } from '../lead-intake.service';
import { StoreResolver } from './connectors.util';

interface LeadgenFieldData {
  name?: string;
  values?: string[];
}

/**
 * F1.4 (#510) — Meta Lead Ads. O webhook entrega só o leadgen_id; buscamos
 * o formulário completo na Graph API e criamos o lead com campanha/anúncio
 * em sourceMeta (base do custo-por-venda no dashboard F3.1).
 */
@Injectable()
export class MetaLeadsService {
  private readonly logger = new Logger(MetaLeadsService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly leadIntake: LeadIntakeService,
    private readonly storeResolver: StoreResolver,
  ) {}

  private graphBase(): string {
    const version = this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v21.0';
    const base = this.config.get<string>('WHATSAPP_GRAPH_BASE_URL') ?? 'https://graph.facebook.com';
    return `${base}/${version}`;
  }

  /** Processa um evento leadgen do webhook (chamado pelo processor) */
  async processLeadgen(value: {
    leadgen_id?: string;
    page_id?: string;
    form_id?: string;
    ad_id?: string;
    adgroup_id?: string;
    campaign_id?: string;
  }): Promise<void> {
    if (!value.leadgen_id) return;
    const token = this.config.get<string>('META_PAGE_ACCESS_TOKEN');
    if (!token) {
      this.logger.error('META_PAGE_ACCESS_TOKEN não configurado — leadgen ignorado');
      return;
    }

    let data: any;
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.graphBase()}/${value.leadgen_id}`, {
          params: {
            access_token: token,
            fields: 'field_data,created_time,campaign_name,campaign_id,adset_name,ad_name,ad_id',
          },
        }),
      );
      data = resp.data;
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      this.logger.error(
        `Falha ao buscar leadgen ${value.leadgen_id}: ${axiosErr.response?.data?.error?.message ?? axiosErr.message}`,
      );
      throw err; // deixa o Bull tentar de novo
    }

    const fields = this.mapFields(data.field_data ?? []);
    const companyId = await this.storeResolver.resolve(fields.store ?? fields.city);

    await this.leadIntake.intake(companyId, {
      name: fields.fullName,
      phone: fields.phone,
      email: fields.email,
      source: LeadSource.META_ADS,
      externalRef: value.leadgen_id,
      interest: fields.interest,
      sourceMeta: {
        leadgenId: value.leadgen_id,
        formId: value.form_id ?? null,
        pageId: value.page_id ?? null,
        campaignId: data.campaign_id ?? value.campaign_id ?? null,
        campaignName: data.campaign_name ?? null,
        adsetName: data.adset_name ?? null,
        adId: data.ad_id ?? value.ad_id ?? null,
        adName: data.ad_name ?? null,
        createdTime: data.created_time ?? null,
      },
    });
  }

  /** field_data → campos conhecidos (nomes padrão da Meta + customizados comuns) */
  private mapFields(fieldData: LeadgenFieldData[]): {
    fullName?: string;
    phone?: string;
    email?: string;
    city?: string;
    store?: string;
    interest?: string;
  } {
    const get = (...names: string[]): string | undefined => {
      for (const f of fieldData) {
        const key = f.name?.toLowerCase() ?? '';
        if (names.some((n) => key === n || key.includes(n))) {
          const v = f.values?.[0]?.trim();
          if (v) return v;
        }
      }
      return undefined;
    };
    return {
      fullName: get('full_name', 'nome'),
      phone: get('phone_number', 'telefone', 'whatsapp', 'celular'),
      email: get('email', 'e-mail'),
      city: get('city', 'cidade'),
      store: get('loja', 'unidade', 'filial'),
      interest: get('modelo', 'produto', 'interesse', 'reboque'),
    };
  }
}
