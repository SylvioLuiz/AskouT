import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, ChevronDownIcon, EventKindIcon, GlobeIcon, LocationIcon, LockIcon, PhotoIcon, PlusIcon, UsersIcon, XIcon } from './icons.tsx';
import { EventAudienceSheet, EventKindSheet, EventRow, EventWhenSheet } from './event-compose.tsx';
import { EventExtrasFields } from './event-extras.tsx';
import { EventInviteSheet } from './event-invite-picker.tsx';
import { LinkPlaceSheet } from './link-place-sheet.tsx';
import { PostponeQuestion } from './event-dates.tsx';
import { Button, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { extrasDraftFrom, extrasFromDraft } from '../lib/event-extras.ts';
import type { EventExtrasDraft } from '../lib/event-extras.ts';
import { whenLabel } from '../lib/event-when.ts';
import { KINDS } from '../lib/explore.ts';
import { eventProblem, isoToLocalInput, localToIso, POST_CAPTION_MAX } from '../lib/post-draft.ts';
import type { LinkedPlace } from '../lib/post-draft.ts';
import type { EventKind, PostView } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

type SheetName = 'when' | 'kind' | 'audience' | 'place' | 'invite';

/**
 * Editar um evento com a mesma cara da criação: capa no topo, nome grande, descrição e as linhas Quando / Onde / Tipo /
 * Quem vê, cada uma com sua folha. O local é opcional; a data pode continuar em votação.
 */
export function EditEventSheet({ post, onClose, onSaved }: { post: PostView; onClose: () => void; onSaved: (post: PostView) => void }) {
  const event = post.event!;
  const [title, setTitle] = useState(event.title);
  const [caption, setCaption] = useState(post.caption ?? '');
  const [starts, setStarts] = useState(event.startsAt ? isoToLocalInput(event.startsAt) : '');
  const [ends, setEnds] = useState(event.endsAt ? isoToLocalInput(event.endsAt) : '');
  // Evento ainda sem data (a votação decide): continua assim até a pessoa escolher uma data.
  const [byPoll, setByPoll] = useState(event.startsAt === null);
  // Mudou a data de um evento que já tinha data: pergunta se é adiamento (sem resposta, não salva).
  const [postponed, setPostponed] = useState<boolean | undefined>();
  const [kind, setKind] = useState<EventKind>(event.kind ?? 'OTHER');
  const [isPrivate, setPrivate] = useState(event.private === true);
  // Admin do evento edita, mas quem vê (público ou só convidados) continua escolha de quem criou.
  const canChangeAudience = post.mine;
  const [place, setPlace] = useState<LinkedPlace | null>(post.placeName ? { name: post.placeName, address: post.placeAddress ?? null, venueId: post.placeVenueId ?? null } : null);
  const [placeChanged, setPlaceChanged] = useState(false);
  const [extras, setExtras] = useState<EventExtrasDraft>(() => extrasDraftFrom(event.extras));
  const extraOptions = useAsync(() => api.eventExtras().then((r) => r.items), []);
  // Amigos novos para convidar: o convite sai ao salvar (quem já foi convidado nem aparece no seletor).
  const [invitees, setInvitees] = useState<string[]>([]);
  const friends = useAsync(() => api.friends(), []);
  const inviteeNames = (friends.data ?? []).filter((f) => invitees.includes(f.userId)).map((f) => `@${f.username}`);
  const [sheet, setSheet] = useState<SheetName | undefined>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  // Capa nova escolhida da galeria: vai junto ao salvar (a foto do lugar ou o vídeo que era a capa sai; as outras fotos ficam).
  const [newCover, setNewCover] = useState<{ file: File; preview: string } | undefined>();
  const coverInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (newCover) URL.revokeObjectURL(newCover.preview); }, [newCover]);

  // A página de trás não rola junto enquanto a edição está aberta.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sheet && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet, busy, onClose]);

  const captionLength = Array.from(caption).length;
  const dateByPoll = byPoll && !starts;
  const missing = [title.trim() ? null : t('nome'), starts || dateByPoll ? null : t('data')].filter((m): m is string => m !== null);
  const when = dateByPoll ? t('Por votação') : whenLabel(starts, ends, new Date());
  const dateMoved = event.startsAt !== null && !dateByPoll && starts !== '' && starts !== isoToLocalInput(event.startsAt);
  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? t('Outros');
  const cover = post.images.find((i) => i.path);
  const answered = extrasFromDraft(extras, extraOptions.data ?? []).length;

  async function save() {
    setMessage(undefined);
    // O início só precisa ser válido de novo se a pessoa mudou o horário.
    const unchanged = event.startsAt !== null && starts === isoToLocalInput(event.startsAt);
    const problem = eventProblem({ title, kind, startsAt: starts, endsAt: ends, dateByPoll }, place, unchanged ? new Date(0) : new Date());
    if (problem) {
      setMessage(problem);
      return;
    }
    if (dateMoved && postponed === undefined) {
      setMessage(t('A data mudou: diga se é um adiamento antes de salvar.'));
      return;
    }
    setBusy(true);
    try {
      const updated = await api.editPost(post.id, {
        caption: caption.trim() || null,
        placeName: place?.name ?? null,
        placeAddress: place?.address ?? null,
        // Só manda o local do AskouT quando a pessoa escolheu outro (ou tirou); senão o vínculo fica como está.
        ...(placeChanged ? { placeVenueId: place?.venueId ?? null } : {}),
        event: {
          title: title.trim(),
          kind,
          startsAt: dateByPoll ? null : localToIso(starts),
          endsAt: !dateByPoll && ends ? localToIso(ends) : null,
          ...(canChangeAudience ? { private: isPrivate } : {}),
          ...(dateMoved && postponed !== undefined ? { postponed } : {}),
          // Sem a lista carregada, não manda `extras` e as respostas ficam como estavam.
          ...(extraOptions.data ? { extras: extrasFromDraft(extras, extraOptions.data) } : {}),
        },
        ...(invitees.length > 0 ? { inviteUserIds: invitees } : {}),
      });
      onSaved(newCover ? await api.setPostCover(post.id, await resizePostPhoto(newCover.file)) : updated);
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <div className="evedit" role="dialog" aria-modal="true" aria-label={t('Editar evento')}>
      <div className="compose compose--event evedit__inner">
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={onClose} aria-label={t('Cancelar')} disabled={busy}>
            <XIcon />
          </button>
          <h1 className="compose__title">{t('Editar evento')}</h1>
          <button type="button" className="compose__next" disabled={busy || missing.length > 0 || captionLength > POST_CAPTION_MAX} onClick={() => void save()}>
            {t('Salvar')}
          </button>
        </header>
        {message ? <Notice tone="error">{message}</Notice> : null}
        {event.postponed && !dateMoved ? <Notice>{event.postponedFrom ? t('Este evento está adiado.') : t('Este evento está adiado, sem nova data. Escolha a nova data em Quando.')}</Notice> : null}

        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = '';
            if (file) setNewCover({ file, preview: URL.createObjectURL(file) });
          }}
        />
        {newCover || cover?.path ? (
          <div className="evcover evcover--compose">
            <img src={newCover ? newCover.preview : api.assetUrl(cover!.path!)} alt={t('Capa do evento')} referrerPolicy="no-referrer" />
            <button type="button" className="evcover__change" onClick={() => coverInput.current?.click()} disabled={busy}>
              <PhotoIcon /> {t('Trocar capa')}
            </button>
            <span className="evcover__kind evcover__kind--icon" aria-hidden="true">
              <EventKindIcon kind={kind} />
            </span>
            {when ? <span className="evcover__when">{when}</span> : null}
          </div>
        ) : (
          <div className="evcover evcover--compose evcover--empty">
            <p>{t('Adicione uma capa (opcional)')}</p>
            <div className="evcover__actions">
              <Button small variant="secondary" onClick={() => coverInput.current?.click()} disabled={busy}>
                <PhotoIcon /> {t('Galeria')}
              </Button>
            </div>
          </div>
        )}

        <input className="evtitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('Nome do evento')} aria-label={t('Nome do evento')} disabled={busy} />
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
          {dateMoved ? (
            <li className="evrows__extra">
              <PostponeQuestion value={postponed} onChange={setPostponed} />
            </li>
          ) : null}
          <EventRow
            icon={<LocationIcon />}
            label={t('Onde')}
            value={place?.name}
            placeholder={t('Opcional')}
            onClick={() => setSheet('place')}
            disabled={busy}
            trailing={
              place ? (
                <button
                  type="button"
                  className="evrow__clear"
                  onClick={() => {
                    setPlace(null);
                    setPlaceChanged(true);
                  }}
                  aria-label={t('Remover o local')}
                >
                  <XIcon />
                </button>
              ) : null
            }
          />
          <EventRow icon={<EventKindIcon kind={kind} />} label={t('Tipo')} value={kindLabel} onClick={() => setSheet('kind')} disabled={busy} />
          <EventRow icon={isPrivate ? <LockIcon /> : <GlobeIcon />} label={t('Quem vê')} value={isPrivate ? t('Só convidados') : t('Público')} onClick={() => setSheet('audience')} disabled={busy || !canChangeAudience} />
          <EventRow
            icon={<UsersIcon />}
            label={t('Convidar')}
            value={inviteeNames.length > 0 ? inviteeNames.join(', ') : null}
            placeholder={t('Mais amigos')}
            onClick={() => setSheet('invite')}
            disabled={busy}
            trailing={
              invitees.length > 0 ? (
                <button type="button" className="evrow__clear" onClick={() => setInvitees([])} aria-label={t('Tirar os convidados novos')}>
                  <XIcon />
                </button>
              ) : null
            }
          />
        </ul>

        {(extraOptions.data ?? []).length > 0 ? (
          <div className={`evmore${moreOpen ? ' evmore--open' : ''}`}>
            <button type="button" className="evmore__head" aria-expanded={moreOpen} aria-controls="evedit-more" onClick={() => setMoreOpen((o) => !o)}>
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
              <div className="evmore__panel" id="evedit-more">
                <EventExtrasFields embedded options={extraOptions.data ?? []} value={extras} onChange={setExtras} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="compose__footer">
          <Button full loading={busy} disabled={missing.length > 0 || captionLength > POST_CAPTION_MAX} onClick={() => void save()}>
            {t('Salvar')}
          </Button>
          {missing.length > 0 ? <p className="evmissing">{t('Falta: {what}', { what: missing.join(` ${t('e')} `) })}</p> : null}
        </div>
      </div>

      {sheet === 'when' ? (
        <EventWhenSheet
          starts={starts}
          ends={ends}
          dateByPoll={dateByPoll}
          // Só um evento que já nasceu sem data pode voltar para a votação.
          allowPoll={event.startsAt === null}
          onDone={(s, e, poll) => {
            setByPoll(poll);
            setStarts(poll ? '' : s);
            setEnds(poll ? '' : e);
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
      {sheet === 'invite' ? (
        <EventInviteSheet
          eventId={post.id}
          picked={invitees}
          onDone={(ids) => {
            setInvitees(ids);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === 'place' ? (
        <LinkPlaceSheet
          onPick={(p) => {
            setPlace(p);
            setPlaceChanged(true);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
    </div>
  );
}
