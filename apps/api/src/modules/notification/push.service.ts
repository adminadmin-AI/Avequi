import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  /** rota do app aberta no clique (ex: /app/crm/inbox?lead=abc) */
  url: string;
  /** agrupa/substitui notificações do mesmo assunto no dispositivo */
  tag?: string;
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/**
 * CRM V2.1 (#568) — Web Push (VAPID). Sem VAPID_* no ambiente o serviço vira
 * no-op silencioso: o resto do CRM não depende de push pra funcionar.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    this.enabled = !!(publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT ?? 'mailto:contato@gdrreboques.com.br',
        publicKey!,
        privateKey!,
      );
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes — web push desativado');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getPublicKey(): { publicKey: string | null } {
    return { publicKey: this.enabled ? process.env.VAPID_PUBLIC_KEY! : null };
  }

  /** Registra (ou reaproveita) a assinatura do dispositivo. Endpoint é único por
   *  navegador: se outro usuário logar no mesmo aparelho, a assinatura muda de dono. */
  async subscribe(userId: string, input: SubscribeInput) {
    const sub = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
    return { id: sub.id, createdAt: sub.createdAt };
  }

  /** Opt-out do dispositivo (só o dono da assinatura remove) */
  async unsubscribe(userId: string, endpoint: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { deleted: count > 0 };
  }

  /** Estado de opt-in do usuário (a tela de config mostra os dispositivos) */
  async listMine(userId: string) {
    return this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Envia a notificação pra TODOS os dispositivos do usuário. Assinatura morta
   * (404/410 do push service) é removida na hora. Nunca lança: push é best-effort
   * — falha de notificação não pode derrubar captação/cron.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled || !userId) return 0;

    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return 0;

    const body = JSON.stringify(payload);
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 300, urgency: 'high' }, // speed-to-lead: entrega imediata ou nada
        );
        sent++;
      } catch (err) {
        const status = (err as webpush.WebPushError).statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => undefined);
          this.logger.log(`Assinatura morta removida (${status}): ${sub.id}`);
        } else {
          this.logger.warn(`Push falhou p/ ${sub.id}: ${(err as Error).message}`);
        }
      }
    }
    return sent;
  }
}
