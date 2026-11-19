import { useEffect, useRef, useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage } from '../lib/types.ts';
import { ArrowUpIcon, MicIcon, PauseIcon, PlayIcon, XIcon } from './icons.tsx';
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
import { t } from '../lib/i18n/index.ts';

/**
 * Categoria de áudio da página no iPhone (Safari 17+ / iOS 17+; nos outros não existe e não faz nada).
 * Sem isso o Web Audio fica na categoria "ambiente": some no modo silencioso e, depois de usar o microfone,
 * sai baixinho pelo alto-falante de ligação. "playback" toca como mídia (alto-falante, ignora a chave do silencioso).
 */
function setAudioSession(type: 'auto' | 'playback' | 'play-and-record'): void {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== type) session.type = type;
  } catch {
    /* navegador sem suporte */
  }
}

export function voiceSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** Data URL com o tipo "limpo" (sem `codecs=`): cada navegador escreve esses parâmetros de um jeito. */
function toDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const base = (blob.type || fallbackMime).split(';')[0]?.trim().toLowerCase() || 'audio/webm';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(`data:${base};base64,${comma >= 0 ? result.slice(comma + 1) : ''}`);
    };
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
    setAudioSession('auto');
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
        setAudioSession('play-and-record');
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
        setAudioSession('auto');
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
        callbacks.current.onProblem(t('Gravação curta demais. Segure por pelo menos 1 segundo.'));
        callbacks.current.onCancel();
        return;
      }
      if (blob.size > VOICE_MAX_BYTES) {
        callbacks.current.onProblem(t('O áudio ficou grande demais. Grave um pouco menos.'));
        callbacks.current.onCancel();
        return;
      }
      try {
        const dataUrl = await toDataUrl(blob, mime);
        await callbacks.current.onSend(dataUrl, Math.min(durationMs, VOICE_MAX_MS));
      } catch (failure) {
        const error = toApiError(failure);
        callbacks.current.onProblem(error.fields['audio'] ?? error.message);
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
    <div className="recbar" role="group" aria-label={t('Gravando áudio')}>
      <button type="button" className="recbar__cancel" onClick={() => finish(false)} aria-label={t('Cancelar gravação')} disabled={busy && !discard.current}>
        <XIcon />
      </button>
      <span className="recbar__dot" aria-hidden="true" />
      <span className="recbar__time" role="timer" aria-live="off">
        {formatVoiceTime(elapsed)}
      </span>
      <span className="recbar__label">{t('Gravando')}</span>
      <button type="button" className="commentbox__send recbar__send" onClick={() => finish(true)} disabled={busy || elapsed < 300} aria-label={t('Enviar áudio')} aria-busy={busy || undefined}>
        <ArrowUpIcon />
      </button>
    </div>
  );
}

// ---------- Ouvir ----------
//
// O áudio toca pela Web Audio API, não por <audio>/new Audio(): no iPhone, um HTMLMediaElement
// vira "mídia do sistema" e aparece no player da central de controle e da tela de bloqueio
// (Now Playing). Um AudioBufferSourceNode não é registrado ali.
// O Web Audio, porém, respeita a chave do silencioso do iPhone: por isso cada toque põe a sessão de
// áudio em "playback" (ver setAudioSession) e a devolve para "auto" quando nada mais está tocando.

type Player = { pause(): void };
let playing: Player | undefined;
let sharedCtx: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  if (sharedCtx) return sharedCtx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  sharedCtx = new Ctor();
  return sharedCtx;
}

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Safari antigo só aceita a forma com callbacks.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/**
 * Nada tocando: suspende o contexto e limpa a sessão de mídia. Com a sessão em "playback" o iPhone trata o
 * contexto como mídia e mostra o player na central de controle e na tela de bloqueio; suspenso, ele sai de lá.
 */
function idle(): void {
  setAudioSession('auto');
  try {
    const media = (navigator as unknown as { mediaSession?: { metadata: unknown; playbackState: string } }).mediaSession;
    if (media) {
      media.metadata = null;
      media.playbackState = 'none';
    }
  } catch {
    /* sem suporte */
  }
  if (sharedCtx && sharedCtx.state === 'running') void sharedCtx.suspend().catch(() => undefined);
}

/** Toca um trecho mudo ainda dentro do toque: no iOS isso "destrava" o contexto para o som que vem depois do download. */
function unlock(ctx: AudioContext) {
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* sem problema: o resume() costuma bastar */
  }
}

/**
 * Balão de mensagem de voz: baixa o áudio (com o token) na primeira vez que toca.
 * `receipt`: mostra o "ouvido" (microfone azul), como no WhatsApp: na sua mensagem, quando alguém ouviu;
 * na dos outros, destacado até você ouvir.
 */
export function VoiceBubble({ message, conversationId, receipt = true }: { message: ChatMessage; conversationId: string; receipt?: boolean }) {
  const [heardNow, setHeardNow] = useState(false);
  const heard = !!message.audio?.played || heardNow;
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [position, setPosition] = useState(0);
  const [decodedMs, setDecodedMs] = useState<number | undefined>(undefined);
  const total = message.audio?.durationMs || decodedMs || 0;
  const buffer = useRef<AudioBuffer | undefined>(undefined);
  const source = useRef<AudioBufferSourceNode | undefined>(undefined);
  const offset = useRef(0); // segundos já tocados quando pausado
  const startedAt = useRef(0); // ctx.currentTime - offset no início do trecho atual
  const raf = useRef<number | undefined>(undefined);
  const player = useRef<Player>({ pause: () => pause() });

  function stopTicking() {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = undefined;
  }

  function stopSource() {
    const src = source.current;
    source.current = undefined;
    if (!src) return;
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* já parado */
    }
    src.disconnect();
  }

  function pause() {
    const ctx = sharedCtx;
    if (!source.current || !ctx) return;
    offset.current = Math.max(0, ctx.currentTime - startedAt.current);
    stopSource();
    stopTicking();
    if (playing === player.current) playing = undefined;
    if (!playing) idle();
    setPosition(offset.current * 1000);
    setState('paused');
  }

  function finished() {
    source.current = undefined;
    stopTicking();
    offset.current = 0;
    if (playing === player.current) playing = undefined;
    if (!playing) idle();
    setPosition(0);
    setState('idle');
  }

  function start(ctx: AudioContext) {
    const buf = buffer.current;
    if (!buf) return;
    if (offset.current >= buf.duration) offset.current = 0;
    // Pausa o outro áudio antes: ao parar, ele suspende o contexto (idle), que este aqui retoma logo abaixo.
    if (playing && playing !== player.current) playing.pause();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = finished;
    startedAt.current = ctx.currentTime - offset.current;
    src.start(0, offset.current);
    source.current = src;
    playing = player.current;
    setAudioSession('playback');
    setState('playing');
    if (!message.mine && !heard) {
      setHeardNow(true);
      api.markAudioPlayed(conversationId, message.id).catch(() => undefined);
    }
    const tick = () => {
      setPosition(Math.min(buf.duration, ctx.currentTime - startedAt.current) * 1000);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }

  useEffect(
    () => () => {
      stopSource();
      stopTicking();
      if (playing === player.current) {
        playing = undefined;
        idle();
      }
    },
    [],
  );

  async function toggle() {
    if (state === 'loading') return;
    if (state === 'playing') {
      pause();
      return;
    }
    // Cria/retoma o contexto ainda dentro do toque: o iOS só libera o som num gesto do usuário.
    const ctx = audioContext();
    if (!ctx) {
      setState('error');
      return;
    }
    setAudioSession('playback');
    unlock(ctx);
    // "suspended" no primeiro toque; "interrupted" no iOS depois de uma ligação, do microfone ou de voltar do fundo.
    const resumed = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
    try {
      if (!buffer.current) {
        setState('loading');
        const blob = await api.messageAudio(conversationId, message.id);
        buffer.current = await decode(ctx, await blob.arrayBuffer());
        setDecodedMs(buffer.current.duration * 1000);
      }
      await resumed;
      start(ctx);
    } catch {
      if (!playing) idle();
      setState('error');
    }
  }

  const shown = state === 'playing' || state === 'paused' ? position : total;
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;
  const receiptLabel = heard ? t('Ouvido') : t('Ainda não ouvido');
  const receiptClass = heard ? ' voice--heard' : message.mine ? '' : ' voice--new';
  return (
    <div className={`voice${receipt ? receiptClass : ''}`}>
      <button type="button" className="voice__btn" onClick={() => void toggle()} aria-label={state === 'playing' ? t('Pausar áudio') : t('Ouvir áudio')} aria-busy={state === 'loading' || undefined}>
        {state === 'playing' ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="voice__track" aria-hidden="true">
        <div className="voice__bar" style={{ width: `${progress}%` }} />
      </div>
      <span className="voice__time">{state === 'error' ? t('Erro ao tocar') : formatVoiceTime(shown)}</span>
      {receipt ? (
        <span className="voice__heard" role="img" aria-label={receiptLabel} title={receiptLabel}>
          <MicIcon />
        </span>
      ) : null}
    </div>
  );
}
