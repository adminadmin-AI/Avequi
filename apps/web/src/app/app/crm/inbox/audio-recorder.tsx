'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/**
 * Gravação de voice note no navegador (F3.5-C6 #556). Ordem dos formatos:
 * ogg-opus (Firefox) e mp4/aac (Safari) a Meta aceita direto; webm-opus
 * (Chrome/Android) o backend remuxa pra ogg. Sem suporte → botão some
 * (o clipe de anexo continua aceitando arquivo de áudio).
 */
const MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus'];

const EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
};

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export function AudioRecorder({
  onSend,
  sending,
  onRecordingChange,
}: {
  onSend: (file: File) => void;
  sending: boolean;
  /** true enquanto grava — o composer esconde o textarea pra dar espaço */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0); // 0..1 — barrinha de nível (feedback de que capta)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const cleanupRef = useRef<() => void>(() => {});

  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // detecção no client (SSR não tem MediaRecorder)
    setSupported(!!navigator.mediaDevices?.getUserMedia && pickMime() != null);
  }, []);

  useEffect(() => () => cleanupRef.current(), []);

  async function start() {
    const mimeType = pickMime();
    if (!mimeType) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('Sem acesso ao microfone. Verifique a permissão do navegador.');
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    discardRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    // nível do microfone (waveform simplificada)
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const meter = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40));
    }, 100);

    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);

    cleanupRef.current = () => {
      clearInterval(timer);
      clearInterval(meter);
      void ctx.close().catch(() => undefined);
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      onRecordingChange?.(false);
      setSeconds(0);
      setLevel(0);
    };

    recorder.onstop = () => {
      const baseMime = mimeType.split(';')[0];
      if (!discardRef.current && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: baseMime });
        if (blob.size > 0) {
          onSend(new File([blob], `voice-note.${EXT[baseMime] ?? 'ogg'}`, { type: baseMime }));
        }
      }
      cleanupRef.current();
    };

    recorderRef.current = recorder;
    recorder.start(500); // chunks de 500ms
    setRecording(true);
    onRecordingChange?.(true);
  }

  function stop(discard: boolean) {
    discardRef.current = discard;
    recorderRef.current?.stop();
  }

  if (!supported) return null; // fallback gracioso: anexo de arquivo continua disponível

  if (!recording) {
    return (
      <Button
        variant="ghost"
        className="h-9 w-9 shrink-0 p-0 text-content-muted"
        aria-label="Gravar áudio"
        title="Gravar áudio"
        disabled={sending}
        onClick={start}
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-danger/50 bg-danger/5 px-2">
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
      <span className="text-xs tabular-nums">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-500/[0.08]">
        <div
          className="h-full rounded-full bg-danger transition-[width] duration-100"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <button
        className="shrink-0 rounded p-1 text-content-muted hover:bg-neutral-500/[0.06]"
        aria-label="Descartar gravação"
        title="Descartar"
        onClick={() => stop(true)}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        className="shrink-0 rounded bg-brand-600 p-1.5 text-white"
        aria-label="Enviar áudio"
        title="Enviar"
        onClick={() => stop(false)}
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
