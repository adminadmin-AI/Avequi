import { spawn } from 'child_process';
import { webmOpusToOgg } from './audio.util';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');

/** Gera um webm-opus real (tom de 440Hz, 0.3s) com o próprio ffmpeg */
function makeWebmSample(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=0.3',
      '-c:a', 'libopus',
      '-f', 'webm',
      'pipe:1',
    ]);
    const out: Buffer[] = [];
    proc.stdout.on('data', (c) => out.push(c));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg sample: ${code}`)),
    );
  });
}

describe('webmOpusToOgg (F3.5-C6 #556) — remux real com ffmpeg', () => {
  it('converte webm-opus (Chrome) em ogg válido sem re-encode', async () => {
    const webm = await makeWebmSample();
    expect(webm.length).toBeGreaterThan(0);

    const ogg = await webmOpusToOgg(webm);
    // container Ogg começa com o magic "OggS"
    expect(ogg.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(ogg.length).toBeGreaterThan(100);
  }, 20_000);

  it('input inválido rejeita com o stderr do ffmpeg', async () => {
    await expect(webmOpusToOgg(Buffer.from('isto não é webm'))).rejects.toThrow(/ffmpeg/);
  }, 20_000);
});
