import { useEffect, useRef, useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage } from '../lib/types.ts';
import { ArrowUpIcon, PauseIcon, PlayIcon, XIcon } from './icons.tsx';
import {
  formatVoiceTime,
  pickVoiceMime,
  VOICE_BITS_PER_SECOND,
  VOICE_MAX_BYTES,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
  voiceProblemFrom,
  voiceProblemMessage,
} from '../lib/voice.ts';

export function voiceSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---------- Gravar ----------

/**
 * Barra de gravação no lugar do campo de texto: cancelar (X), tempo e enviar (seta). Começa a gravar ao aparecer.
 * Passando dos 90 s a gravação para e é enviada sozinha.
 */
export function VoiceRecorderBar({ onSend, onCancel, onProblem }: { onSend: (audio: string, durationMs: number) => Promise<void>; onCancel: () => void; onProblem: (message: string) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const discard = useRef(false);
  const finished = useRef(false);
  const callbacks = useRef({ onSend, onCancel, onProblem });
  callbacks.current = { onSend, onCancel, onProblem };

  function release() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = undefined;
  }

  useEffect(() => {
    let alive = true;
    const timer = window.setInterval(() => {
      if (startedAt.current === 0) return;
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= VOICE_MAX_MS) finish(true);
    }, 200);

    async function begin() {
      if (!voiceSupported()) {
        callbacks.current.onProblem(voiceProblemMessage('unsupported'));
        callbacks.current.onCancel();
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (!alive) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        const mimeType = pickVoiceMime((m) => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: VOICE_BITS_PER_SECOND });
        recorder.current = rec;
        rec.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data);
        };
        rec.onstop = () => void done(rec.mimeType || mimeType || '');
        rec.start(500);
        startedAt.current = Date.now();
      } catch (failure) {
        callbacks.current.onProblem(voiceProblemMessage(voiceProblemFrom(failure)));
        callbacks.current.onCancel();
      }
    }

    async function done(mime: string) {
      const durationMs = Date.now() - startedAt.current;
      release();
      if (discard.current) return;
      const blob = new Blob(chunks.current, { type: mime });
      if (durationMs < VOICE_MIN_MS) {
        callbacks.current.onProblem('Gravação curta demais. Segure por pelo menos 1 segundo.');
        callbacks.current.onCancel();
        return;
      }
      if (blob.size > VOICE_MAX_BYTES) {
        callbacks.current.onProblem('O áudio ficou grande demais. Grave um pouco menos.');
        callbacks.current.onCancel();
        return;
      }
      try {
        const dataUrl = await toDataUrl(blob);
        await callbacks.current.onSend(dataUrl, Math.min(durationMs, VOICE_MAX_MS));
      } catch (failure) {
        callbacks.current.onProblem(toApiError(failure).message);
      }
      callbacks.current.onCancel();
    }

    void begin();
    return () => {
      alive = false;
      window.clearInterval(timer);
      discard.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(send: boolean) {
    if (finished.current) return;
    finished.current = true;
    discard.current = !send;
    setBusy(true);
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else {
      release();
      callbacks.current.onCancel();
    }
    if (!send) callbacks.current.onCancel();
  }

  return (
    <div className="recbar" role="group" aria-label="Gravando áudio">
      <button type="button" className="recbar__cancel" onClick={() => finish(false)} aria-label="Cancelar gravação" disabled={busy && !discard.current}>
        <XIcon />
      </button>
      <span className="recbar__dot" aria-hidden="true" />
      <span className="recbar__time" role="timer" aria-live="off">
        {formatVoiceTime(elapsed)}
      </span>
      <span className="recbar__label">Gravando</span>
      <button type="button" className="commentbox__send recbar__send" onClick={() => finish(true)} disabled={busy || elapsed < 300} aria-label="Enviar áudio" aria-busy={busy || undefined}>
        <ArrowUpIcon />
      </button>
    </div>
  );
}

// ---------- Ouvir ----------

let playing: HTMLAudioElement | undefined;

/** Balão de mensagem de voz: baixa o áudio (com o token) na primeira vez que toca. */
export function VoiceBubble({ message, conversationId }: { message: ChatMessage; conversationId: string }) {
  const total = message.audio?.durationMs ?? 0;
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const url = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (playing === audio.current) playing = undefined;
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  async function toggle() {
    if (state === 'loading') return;
    if (state === 'playing') {
      audio.current?.pause();
      return;
    }
    try {
      if (!audio.current) {
        setState('loading');
        const blob = await api.messageAudio(conversationId, message.id);
        url.current = URL.createObjectURL(blob);
        const el = new Audio(url.current);
        el.onplay = () => setState('playing');
        el.onpause = () => setState(el.ended ? 'idle' : 'paused');
        el.onended = () => {
          setState('idle');
          setPosition(0);
        };
        el.ontimeupdate = () => setPosition(el.currentTime * 1000);
        el.onerror = () => setState('error');
        audio.current = el;
      }
      if (playing && playing !== audio.current) playing.pause();
      playing = audio.current;
      await audio.current.play();
    } catch {
      setState('error');
    }
  }

  const shown = state === 'playing' || state === 'paused' ? position : total;
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;
  return (
    <div className="voice">
      <button type="button" className="voice__btn" onClick={() => void toggle()} aria-label={state === 'playing' ? 'Pausar áudio' : 'Ouvir áudio'} aria-busy={state === 'loading' || undefined}>
        {state === 'playing' ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="voice__track" aria-hidden="true">
        <div className="voice__bar" style={{ width: `${progress}%` }} />
      </div>
      <span className="voice__time">{state === 'error' ? 'Erro ao tocar' : formatVoiceTime(shown)}</span>
    </div>
  );
}
