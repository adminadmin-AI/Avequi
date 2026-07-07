import { spawn } from 'child_process';

// ffmpeg-static exporta a string do path via module.exports (CJS puro) — sem
// esModuleInterop no projeto, o default import viria undefined em runtime
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string | null = require('ffmpeg-static');

/**
 * F3.5-C6 (#556) — a Meta só aceita áudio aac/mp4/mpeg/amr/ogg-opus; o Chrome
 * grava audio/webm (opus). Como webm e ogg carregam o MESMO codec, isso é um
 * remux de container (-c:a copy): rápido, sem re-encode e sem perda.
 */
export async function webmOpusToOgg(input: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg indisponível neste ambiente');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-c:a', 'copy',
      '-f', 'ogg',
      'pipe:1',
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (c) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && out.length > 0) return resolve(Buffer.concat(out));
      reject(new Error(`ffmpeg saiu com ${code}: ${Buffer.concat(err).toString().slice(-300)}`));
    });
    proc.stdin.on('error', () => undefined); // EPIPE se o ffmpeg morrer antes do write
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
