import { ConfigService } from '@nestjs/config';
import { TranscriptionService } from './transcription.service';

/**
 * F1 voz do SDR (#506/#567) — STT de voice notes inbound. fetch nativo mockado;
 * FormData/Blob reais (Node 20+, como no whatsapp.spec).
 */
describe('TranscriptionService (F1 voz #506/#567)', () => {
  const makeService = (env: Record<string, string | undefined> = {}) => {
    const config = { get: jest.fn((k: string) => env[k]) } as unknown as ConfigService;
    return new TranscriptionService(config);
  };
  const audio = Buffer.from('fake-ogg-opus-bytes');

  afterEach(() => jest.restoreAllMocks());

  it('sem OPENAI_API_KEY → null e NÃO chama a API (fluxo atual intacto)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const svc = makeService({});
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.transcribe(audio, 'audio/ogg')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('transcrição ok → devolve o texto (trim) e envia model default + language pt', async () => {
    let captured: RequestInit | undefined;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      captured = init;
      return { ok: true, json: async () => ({ text: '  quero um reboque pra jet ski  ' }) } as Response;
    });
    const svc = makeService({ OPENAI_API_KEY: 'sk-openai' });

    const out = await svc.transcribe(audio, 'audio/ogg; codecs=opus');

    expect(out).toBe('quero um reboque pra jet ski');
    const form = captured!.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('pt');
    expect((form.get('file') as File).name).toBe('audio.ogg'); // extensão inferida do mime
    expect((captured!.headers as Record<string, string>).Authorization).toBe('Bearer sk-openai');
  });

  it('CRM_STT_MODEL sobrescreve o modelo (fallback documentado whisper-1)', async () => {
    let captured: RequestInit | undefined;
    jest.spyOn(global, 'fetch').mockImplementation(async (_u, init) => {
      captured = init;
      return { ok: true, json: async () => ({ text: 'ok' }) } as Response;
    });
    const svc = makeService({ OPENAI_API_KEY: 'k', CRM_STT_MODEL: 'whisper-1' });

    await svc.transcribe(audio, 'audio/ogg');

    expect((captured!.body as FormData).get('model')).toBe('whisper-1');
  });

  it('erro HTTP da API → null (nunca lança pro fluxo do webhook)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' } as Response);
    const svc = makeService({ OPENAI_API_KEY: 'k' });
    expect(await svc.transcribe(audio, 'audio/ogg')).toBeNull();
  });

  it('erro de rede → null (nunca lança)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const svc = makeService({ OPENAI_API_KEY: 'k' });
    expect(await svc.transcribe(audio, 'audio/ogg')).toBeNull();
  });

  it('áudio acima de 20MB → null sem chamar a API (proteção de custo)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    const svc = makeService({ OPENAI_API_KEY: 'k' });
    expect(await svc.transcribe(big, 'audio/ogg')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resposta sem campo text → null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const svc = makeService({ OPENAI_API_KEY: 'k' });
    expect(await svc.transcribe(audio, 'audio/ogg')).toBeNull();
  });
});
