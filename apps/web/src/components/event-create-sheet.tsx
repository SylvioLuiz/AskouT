import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, ChevronDownIcon, EventKindIcon, GlobeIcon, LocationIcon, LockIcon, PhotoIcon, PlusIcon, XIcon } from './icons.tsx';
import { EventAudienceSheet, EventKindSheet, EventRow, EventWhenSheet } from './event-compose.tsx';
import { EventExtrasFields } from './event-extras.tsx';
import { LinkPlaceSheet } from './link-place-sheet.tsx';
import { Button, Notice } from './ui.tsx';
import { Sheet } from './agenda.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { extrasFromDraft } from '../lib/event-extras.ts';
import type { EventExtrasDraft } from '../lib/event-extras.ts';
import { whenLabel } from '../lib/event-when.ts';
import { KINDS } from '../lib/explore.ts';
import { buildPostBody, eventProblem, POST_CAPTION_MAX } from '../lib/post-draft.ts';
import type { DraftImage, LinkedEvent, LinkedPlace } from '../lib/post-draft.ts';
import type { EventKind } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

type SheetName = 'when' | 'kind' | 'audience' | 'place' | 'discard';

/**
 * Criar um evento sem sair do post que está sendo escrito: a mesma cara da tela de evento (capa, nome, descrição e as
 * linhas Quando / Onde / Tipo / Quem vê), por cima do rascunho. Ao criar, devolve o evento para ser vinculado ao post.
 */
export function CreateEventSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (event: LinkedEvent) => void }) {
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [kind, setKind] = useState<EventKind>('OTHER');
  const [isPrivate, setPrivate] = useState(false);
  const [place, setPlace] = useState<LinkedPlace | null>(null);
  const [extras, setExtras] = useState<EventExtrasDraft>({});
  const extraOptions = useAsync(() => api.eventExtras().then((r) => r.items), []);
  const [cover, setCover] = useState<{ dataUrl: string } | undefined>();
  const [readingCover, setReadingCover] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<SheetName | undefined>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const dirty = title.trim() !== '' || caption.trim() !== '' || starts !== '' || place !== null || cover !== undefined;
  function close() {
    if (busy) return;
    if (dirty) setSheet('discard');
    else onClose();
  }

  // O rascunho do post fica parado por trás enquanto o evento é criado.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sheet) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const captionLength = Array.from(caption).length;
  const missing = [title.trim() ? null : t('nome'), starts ? null : t('data')].filter((m): m is string => m !== null);
  const when = whenLabel(starts, ends, new Date());
  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? t('Outros');
  const answered = extrasFromDraft(extras, extraOptions.data ?? []).length;

  async function pickCover(file: File) {
    setReadingCover(true);
    setMessage(undefined);
    try {
      setCover({ dataUrl: await resizePostPhoto(file) });
    } catch (failure) {
      setMessage(failure instanceof Error && failure.message ? failure.message : t('Não foi possível usar esta foto.'));
    } finally {
      setReadingCover(false);
    }
  }

  async function create() {
    setMessage(undefined);
    const draft = { title, kind, startsAt: starts, endsAt: ends, private: isPrivate, extras: extrasFromDraft(extras, extraOptions.data ?? []) };
    const problem = eventProblem(draft, place, new Date());
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    try {
      const images: DraftImage[] = cover ? [{ key: 'capa', kind: 'UPLOAD', preview: cover.dataUrl, dataUrl: cover.dataUrl }] : [];
      const created = await api.createPost(buildPostBody(images, caption, place, [], draft));
      onCreated({ id: created.id, title: created.event?.title ?? title.trim() });
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <div className="evedit" role="dialog" aria-modal="true" aria-label={t('Criar evento')}>
      <div className="compose compose--event evedit__inner">
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={close} aria-label={t('Voltar para a publicação')} disabled={busy}>
            <XIcon />
          </button>
          <h1 className="compose__title">{t('Novo evento')}</h1>
          <button type="button" className="compose__next" disabled={busy || missing.length > 0 || captionLength > POST_CAPTION_MAX} onClick={() => void create()}>
            {t('Criar')}
          </button>
        </header>
        <p className="muted evcreate__hint">{t('Ao criar, o evento já fica vinculado à sua publicação. O texto e as fotos do post continuam lá.')}</p>
        {message ? <Notice tone="error">{message}</Notice> : null}

        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = '';
            if (file) void pickCover(file);
          }}
        />
        {cover ? (
          <div className="evcover">
            <img src={cover.dataUrl} alt={t('Capa do evento')} />
            <button type="button" className="evcover__change" onClick={() => coverInput.current?.click()} disabled={busy || readingCover}>
              <PhotoIcon /> {t('Trocar capa')}
            </button>
            <span className="evcover__kind evcover__kind--icon" aria-hidden="true">
              <EventKindIcon kind={kind} />
            </span>
            {when ? <span className="evcover__when">{when}</span> : null}
          </div>
        ) : (
          <div className="evcover evcover--empty">
            <p>{readingCover ? t('Preparando as fotos…') : t('Adicione uma capa (opcional)')}</p>
            <div className="evcover__actions">
              <Button small variant="secondary" loading={readingCover} onClick={() => coverInput.current?.click()} disabled={busy}>
                <PhotoIcon /> {t('Galeria')}
              </Button>
            </div>
          </div>
        )}

        <input className="evtitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('Nome do evento')} aria-label={t('Nome do evento')} disabled={busy} autoFocus />
        <textarea
          className="evdesc"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t('Conte mais sobre o evento…')}
          aria-label={t('Descrição do evento')}
          maxLength={POST_CAPTION_MAX + 20}
          rows={2}
          aria-invalid={captionLength > POST_CAPTION_MAX || undefined}
          disabled={busy}
        />
        {captionLength > POST_CAPTION_MAX * 0.8 ? (
          <p className={`compose__count${captionLength > POST_CAPTION_MAX ? ' compose__count--over' : ''}`} aria-live="polite">
            {captionLength}/{POST_CAPTION_MAX}
          </p>
        ) : null}

        <ul className="evrows">
          <EventRow icon={<CalendarIcon />} label={t('Quando')} value={when} placeholder={t('Escolher')} onClick={() => setSheet('when')} disabled={busy} />
          <EventRow
            icon={<LocationIcon />}
            label={t('Onde')}
            value={place?.name}
            placeholder={t('Opcional')}
            onClick={() => setSheet('place')}
            disabled={busy}
            trailing={
              place ? (
                <button type="button" className="evrow__clear" onClick={() => setPlace(null)} aria-label={t('Remover o local')}>
                  <XIcon />
                </button>
              ) : null
            }
          />
          <EventRow icon={<EventKindIcon kind={kind} />} label={t('Tipo')} value={kindLabel} onClick={() => setSheet('kind')} disabled={busy} />
          <EventRow icon={isPrivate ? <LockIcon /> : <GlobeIcon />} label={t('Quem vê')} value={isPrivate ? t('Só convidados') : t('Público')} onClick={() => setSheet('audience')} disabled={busy} />
        </ul>

        {(extraOptions.data ?? []).length > 0 ? (
          <div className={`evmore${moreOpen ? ' evmore--open' : ''}`}>
            <button type="button" className="evmore__head" aria-expanded={moreOpen} aria-controls="evcreate-more" onClick={() => setMoreOpen((o) => !o)}>
              <span className="evrow__icon" aria-hidden="true">
                <PlusIcon />
              </span>
              <span className="evmore__text">
                <span className="evmore__title">{t('Mais detalhes')}</span>
                <span className="evmore__sub">{answered > 0 ? (answered === 1 ? t('1 informação') : t('{count} informações', { count: answered })) : (extraOptions.data ?? []).slice(0, 3).map((o) => o.label.toLowerCase()).join(', ')}</span>
              </span>
              <span className="evmore__chev" aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>
            {moreOpen ? (
              <div className="evmore__panel" id="evcreate-more">
                <EventExtrasFields embedded options={extraOptions.data ?? []} value={extras} onChange={setExtras} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="compose__footer">
          <Button full loading={busy} disabled={missing.length > 0 || captionLength > POST_CAPTION_MAX || readingCover} onClick={() => create()}>
            {t('Criar e vincular ao post')}
          </Button>
          {missing.length > 0 ? <p className="evmissing">{t('Falta: {what}', { what: missing.join(` ${t('e')} `) })}</p> : null}
        </div>
      </div>

      {sheet === 'when' ? (
        <EventWhenSheet
          starts={starts}
          ends={ends}
          onDone={(s, e) => {
            setStarts(s);
            setEnds(e);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === 'kind' ? (
        <EventKindSheet
          value={kind}
          onPick={(k) => {
            setKind(k);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === 'audience' ? (
        <EventAudienceSheet
          isPrivate={isPrivate}
          onPick={(v) => {
            setPrivate(v);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === 'place' ? (
        <LinkPlaceSheet
          onPick={(p) => {
            setPlace(p);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === 'discard' ? (
        <Sheet title={t('Descartar o evento?')} onClose={() => setSheet(undefined)}>
          <p className="muted">{t('O evento não será criado. Sua publicação continua como estava.')}</p>
          <Button variant="danger" full onClick={onClose}>
            {t('Descartar evento')}
          </Button>
          <Button variant="quiet" full onClick={() => setSheet(undefined)}>
            {t('Continuar criando')}
          </Button>
        </Sheet>
      ) : null}
    </div>
  );
}
