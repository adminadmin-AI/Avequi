export const WHATSAPP_QUEUE = 'WHATSAPP_QUEUE';

/** Payload bruto do webhook da Cloud API enfileirado p/ processamento assíncrono */
export interface WhatsappWebhookJobData {
  body: WhatsappWebhookBody;
}

// Formas mínimas do payload da Meta que consumimos (dicionário: developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
export interface WhatsappWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: WhatsappChangeValue;
    }>;
  }>;
}

export interface WhatsappChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: Array<WhatsappInboundMessage>;
  statuses?: Array<{
    id?: string;
    status?: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
}

export interface WhatsappInboundMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  audio?: WhatsappMedia;
  image?: WhatsappMedia & { caption?: string };
  video?: WhatsappMedia & { caption?: string };
  document?: WhatsappMedia & { filename?: string; caption?: string };
  sticker?: WhatsappMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

export interface WhatsappMedia {
  id?: string;
  mime_type?: string;
  sha256?: string;
  voice?: boolean;
}
