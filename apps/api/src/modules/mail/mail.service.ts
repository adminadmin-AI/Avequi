import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  ok: boolean;
  reason?: string;
}

/**
 * Serviço de e-mail transacional (primeiro do repo — #530).
 *
 * SMTP genérico via env (SMTP_HOST/PORT/USER/PASS/FROM) para não acoplar a
 * provedor. FAIL-SAFE por contrato: sem SMTP configurado ou falha de envio,
 * resolve `{ ok: false, reason }` — NUNCA lança. Quem decide se e-mail é
 * crítico é o chamador (na cadeia RENAVE é best-effort).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null | undefined;

  async send(input: SendMailInput): Promise<SendMailResult> {
    const transporter = this.getTransporter();
    if (!transporter) {
      return { ok: false, reason: 'SMTP não configurado (SMTP_HOST ausente)' };
    }
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to: input.to,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments,
      });
      return { ok: true };
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.warn(`Falha ao enviar e-mail para ${input.to}: ${reason}`);
      return { ok: false, reason };
    }
  }

  private getTransporter(): Transporter | null {
    if (this.transporter !== undefined) return this.transporter;
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.transporter = null;
      return null;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_PORT === '465',
      ...(process.env.SMTP_USER && {
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      }),
    });
    return this.transporter;
  }
}
