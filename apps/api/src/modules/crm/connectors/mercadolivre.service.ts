import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadActivityType, LeadSource } from '@prisma/client';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeadIntakeService } from '../lead-intake.service';

const ML_API = 'https://api.mercadolibre.com';
const PARAM_ACCESS = 'ML_ACCESS_TOKEN';
const PARAM_REFRESH = 'ML_REFRESH_TOKEN';

/**
 * F1.5 (#511) — Mercado Livre. Perguntas em anúncios viram lead (sem telefone —
 * dedup por externalRef = id do autor) e são respondíveis de dentro do inbox.
 *
 * Tokens: o refresh token do ML ROTACIONA a cada uso — por isso o par
 * access/refresh vive em SystemParameter (matriz), seedado dos envs
 * ML_ACCESS_TOKEN/ML_REFRESH_TOKEN na primeira execução.
 */
@Injectable()
export class MercadoLivreService {
  private readonly logger = new Logger(MercadoLivreService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly leadIntake: LeadIntakeService,
  ) {}

  /** Processa notificação de pergunta (chamado pelo processor) */
  async processQuestion(resource: string): Promise<void> {
    const questionId = resource.split('/').filter(Boolean).pop();
    if (!questionId) return;

    const q = await this.mlGet(`/questions/${questionId}`);
    if (!q || q.status !== 'UNANSWERED') return; // já respondida/deletada

    const item = await this.mlGet(`/items/${q.item_id}`).catch(() => null);

    const { lead, created } = await this.leadIntake.intake(null, {
      // pergunta ML não expõe telefone — dedup pela conta do comprador
      source: LeadSource.MERCADO_LIVRE,
      externalRef: `ml-user-${q.from?.id}`,
      name: q.from?.nickname ? `ML: ${q.from.nickname}` : undefined,
      interest: item?.title,
      sourceMeta: {
        questionId: q.id,
        itemId: q.item_id,
        itemTitle: item?.title ?? null,
        itemUrl: item?.permalink ?? null,
        buyerId: q.from?.id ?? null,
      },
    });

    // pergunta vira atividade na timeline (respondível via answerQuestion)
    await this.prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: LeadActivityType.MESSAGE_IN,
        properties: {
          channel: 'MERCADO_LIVRE',
          questionId: q.id,
          text: String(q.text ?? '').slice(0, 500),
          itemTitle: item?.title ?? null,
          answered: false,
        },
      },
    });
    this.logger.log(
      `Pergunta ML ${q.id} registrada no lead ${lead.id} (${created ? 'novo' : 'existente'})`,
    );
  }

  /** Responde a pergunta do anúncio de dentro do ERP (inbox) */
  async answerQuestion(companyId: string, leadId: string, questionId: string, text: string, actorId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!text?.trim()) throw new BadRequestException('Resposta vazia');

    await this.mlPost('/answers', { question_id: Number(questionId), text: text.trim() });

    await this.prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: LeadActivityType.MESSAGE_OUT,
        actorId,
        properties: { channel: 'MERCADO_LIVRE', questionId, text: text.trim().slice(0, 500) },
      },
    });
    return { ok: true };
  }

  // ── HTTP c/ refresh automático (refresh token do ML rotaciona) ─────────────

  private async mlGet(path: string): Promise<any> {
    return this.withAuthRetry((token) =>
      firstValueFrom(
        this.http.get(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      ).then((r) => r.data),
    );
  }

  private async mlPost(path: string, body: unknown): Promise<any> {
    return this.withAuthRetry((token) =>
      firstValueFrom(
        this.http.post(`${ML_API}${path}`, body, { headers: { Authorization: `Bearer ${token}` } }),
      ).then((r) => r.data),
    );
  }

  private async withAuthRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getParam(PARAM_ACCESS, this.config.get<string>('ML_ACCESS_TOKEN'));
    if (!token) throw new BadRequestException('Mercado Livre não configurado (ML_ACCESS_TOKEN)');
    try {
      return await fn(token);
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status !== 401 && status !== 403) throw err;
      const fresh = await this.refreshToken();
      return fn(fresh);
    }
  }

  private async refreshToken(): Promise<string> {
    const clientId = this.config.get<string>('ML_CLIENT_ID');
    const clientSecret = this.config.get<string>('ML_CLIENT_SECRET');
    const refresh = await this.getParam(PARAM_REFRESH, this.config.get<string>('ML_REFRESH_TOKEN'));
    if (!clientId || !clientSecret || !refresh) {
      throw new BadRequestException('Refresh do ML não configurado (ML_CLIENT_ID/SECRET/REFRESH_TOKEN)');
    }
    const resp = await firstValueFrom(
      this.http.post(`${ML_API}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
      }),
    );
    const { access_token, refresh_token } = resp.data;
    await Promise.all([
      this.setParam(PARAM_ACCESS, access_token),
      this.setParam(PARAM_REFRESH, refresh_token ?? refresh),
    ]);
    this.logger.log('Token ML renovado (refresh rotacionado e persistido)');
    return access_token;
  }

  private async matrizId(): Promise<string> {
    const matriz = await this.prisma.company.findFirst({
      where: { type: 'MATRIZ' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!matriz) throw new BadRequestException('Sem company matriz p/ guardar tokens ML');
    return matriz.id;
  }

  private async getParam(key: string, envFallback?: string): Promise<string | undefined> {
    const companyId = await this.matrizId();
    const param = await this.prisma.systemParameter.findFirst({ where: { companyId, key } });
    if (param?.value) return param.value;
    if (envFallback) {
      await this.setParam(key, envFallback); // seed inicial a partir do env
      return envFallback;
    }
    return undefined;
  }

  private async setParam(key: string, value: string): Promise<void> {
    const companyId = await this.matrizId();
    const existing = await this.prisma.systemParameter.findFirst({ where: { companyId, key } });
    if (existing) {
      await this.prisma.systemParameter.update({ where: { id: existing.id }, data: { value } });
    } else {
      await this.prisma.systemParameter.create({ data: { companyId, key, value } });
    }
  }
}
