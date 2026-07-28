import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * F1 voz do SDR (#506/#567) — transcrição (STT) de voice notes INBOUND do
 * WhatsApp pela API de áudio da OpenAI. Serviço PURO: recebe o Buffer do áudio
 * já baixado + o mimetype e devolve o texto (ou null). Não conhece a Meta nem
 * o Prisma — quem baixa a mídia e persiste a transcrição é o webhook processor.
 *
 * Regras de robustez (o webhook NUNCA pode quebrar por causa disso):
 * - sem OPENAI_API_KEY → null + debug (comportamento atual preservado: o SDR
 *   avisa que vai passar pro vendedor, como já fazia com áudio "que não vê").
 * - erro de rede / HTTP / timeout (30s) → null + warn, nunca lança.
 * - áudio > 20MB → null + warn (proteção de custo; voice note de WhatsApp é
 *   ogg/opus ~16-24kbps, então 20MB já cobre com folga um áudio bem longo — a
 *   Meta limita mídia inbound a 16MB, então >20MB nem chega por este canal).
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  /** proteção de custo: recusa áudio acima disso (ver nota no cabeçalho) */
  private static readonly MAX_BYTES = 20 * 1024 * 1024;
  /** aborta a chamada de STT se estourar (webhook não pode ficar preso) */
  private static readonly TIMEOUT_MS = 30_000;
  private static readonly ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
  /** default barato; fallback documentado: `whisper-1` (via CRM_STT_MODEL) */
  private static readonly DEFAULT_MODEL = 'gpt-4o-mini-transcribe';

  constructor(private readonly config: ConfigService) {}

  /** true quando há OPENAI_API_KEY — permite o processor pular o download da mídia */
  isEnabled(): boolean {
    return !!this.config.get<string>('OPENAI_API_KEY');
  }

  /**
   * Transcreve o áudio. Retorna o texto (trim) ou null em QUALQUER situação de
   * indisponibilidade/erro/limite — nunca lança.
   */
  async transcribe(audio: Buffer, mimeType?: string): Promise<string | null> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.debug('OPENAI_API_KEY ausente — STT desabilitado; SDR segue no fluxo atual');
      return null;
    }
    if (!audio || audio.length === 0) {
      this.logger.warn('STT: áudio vazio — pulando transcrição');
      return null;
    }
    if (audio.length > TranscriptionService.MAX_BYTES) {
      this.logger.warn(
        `STT: áudio de ${(audio.length / 1024 / 1024).toFixed(1)}MB excede o limite de 20MB — pulando (proteção de custo)`,
      );
      return null;
    }

    const model = this.config.get<string>('CRM_STT_MODEL') || TranscriptionService.DEFAULT_MODEL;
    const baseMime = (mimeType ?? 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TranscriptionService.TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const form = new FormData();
      // Uint8Array satisfaz BlobPart (Buffer não, pela tipagem SharedArrayBuffer do Node 22)
      form.append('file', new Blob([new Uint8Array(audio)], { type: baseMime }), this.fileName(baseMime));
      form.append('model', model);
      form.append('language', 'pt');

      const resp = await fetch(TranscriptionService.ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const detail = (await resp.text().catch(() => '')).slice(0, 300);
        this.logger.warn(`STT falhou (HTTP ${resp.status} ${model}): ${detail}`);
        return null;
      }

      const json = (await resp.json()) as { text?: string };
      const text = json.text?.trim();
      if (!text) {
        this.logger.warn('STT: resposta sem texto — pulando');
        return null;
      }

      this.logger.log(
        `STT ok: ${audio.length} bytes, modelo ${model}, ${Date.now() - startedAt}ms, ${text.length} chars`,
      );
      return text;
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      this.logger.warn(
        `STT ${aborted ? `timeout (${TranscriptionService.TIMEOUT_MS}ms)` : 'erro'}: ${(err as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** nome/extensão que a OpenAI usa p/ inferir o formato do áudio */
  private fileName(baseMime: string): string {
    const ext =
      {
        'audio/ogg': 'ogg',
        'audio/opus': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/mp4': 'm4a',
        'audio/m4a': 'm4a',
        'audio/x-m4a': 'm4a',
        'audio/aac': 'aac',
        'audio/amr': 'amr',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
      }[baseMime] ?? 'ogg';
    return `audio.${ext}`;
  }
}
