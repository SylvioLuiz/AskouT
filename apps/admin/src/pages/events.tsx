import { useState } from 'react';
import { api, appUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { EVENT_KIND_LABEL, EVENT_KIND_OPTIONS, FEED_POLICY_LABEL, eventStatus, formatCents, formatDateTime, formatDuration, formatEventWhen } from '../labels.ts';
import type { EventDetail, FeedPolicy, PlaceEventRow } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { CheckInput, DateTimeInput, LinkedList, Mono, PersonLink, RecordLink, RecordModal, RecordView, SelectInput, TextArea, TextInput, YesNo, fromLocalInput, toLocalInput, useOpenRecord, useRecordEditor, useReloadOnChange } from '../record.tsx';
import type { RecordSection } from '../record.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';

const STATUS_LABEL = { UPCOMING: 'Por vir', LIVE: 'Acontecendo agora', PAST: 'Já passou' } as const;
const STATUS_TONE = { UPCOMING: 'info', LIVE: 'ok', PAST: undefined } as const;

type EventDraft = {
  title: string;
  description: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  imageUrl: string;
  tags: string;
  ticketUrl: string;
  isSample: boolean;
  feedPolicy: FeedPolicy;
};

const FEED_OPTIONS = (Object.keys(FEED_POLICY_LABEL) as FeedPolicy[]).map((value) => ({ value, label: FEED_POLICY_LABEL[value] }));
const tagsOf = (text: string) => [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter((t) => t !== ''))];

/**
 * Detalhe do evento: quando, onde, quem responde, quem confirmou, as outras datas com o mesmo nome (locais repetem o nome toda
 * semana) e o que está ligado a ele (feed, chapelaria, lista, Hunter). "Editar" corrige o cadastro com as regras de quem administra.
 */
export function EventDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [currentId, setCurrentId] = useState(id);
  const detail = useAsync(() => api.placeEvent(currentId), [currentId]);
  return (
    <RecordModal state={detail} label="Evento" onClose={onClose}>
      {(e) => <EventRecord key={e.id} e={e} onClose={onClose} reload={detail.reload} onOpenDate={setCurrentId} />}
    </RecordModal>
  );
}

function EventRecord({ e, onClose, reload, onOpenDate }: { e: EventDetail; onClose: () => void; reload: () => void; onOpenDate: (id: string) => void }) {
  const x = e.extra;
  const editor = useRecordEditor<EventDraft>({
    initial: {
      title: e.title, description: e.description ?? '', kind: e.kind, startsAt: toLocalInput(e.startsAt), endsAt: toLocalInput(e.endsAt), isFree: e.isFree,
      imageUrl: e.imageUrl ?? '', tags: e.tags.map((t) => `#${t}`).join(' '), ticketUrl: e.ticketUrl ?? '', isSample: e.isSample, feedPolicy: x?.feedPolicy ?? 'OWNER_ONLY',
    },
    check: (d) => ({
      ...(d.title.trim() === '' ? { title: 'Informe o nome' } : {}),
      ...(d.startsAt === '' ? { startsAt: 'Informe o início' } : {}),
      ...(d.startsAt !== '' && d.endsAt !== '' && new Date(d.endsAt).getTime() <= new Date(d.startsAt).getTime() ? { endsAt: 'O fim precisa ser depois do início' } : {}),
    }),
    save: (changes, note, d) =>
      api.editPlaceEvent(
        e.id,
        {
          // Nome, datas, tipo e entrada vão sempre (a API confere o evento inteiro, como para quem administra).
          title: d.title.trim(), startsAt: fromLocalInput(d.startsAt), endsAt: d.endsAt === '' ? '' : fromLocalInput(d.endsAt), kind: d.kind, isFree: d.isFree,
          // Descrição e hashtags também: ausentes, a API as apagaria.
          description: d.description.trim() === '' ? null : d.description, tags: tagsOf(d.tags),
          ...(changes.imageUrl !== undefined ? { imageUrl: d.imageUrl.trim() === '' ? null : d.imageUrl.trim() } : {}),
          ...(changes.ticketUrl !== undefined ? { ticketUrl: d.ticketUrl.trim() === '' ? null : d.ticketUrl.trim() } : {}),
          ...(changes.isSample !== undefined ? { isSample: d.isSample } : {}),
          ...(changes.feedPolicy !== undefined ? { feedPolicy: d.feedPolicy } : {}),
        },
        note,
      ),
    onSaved: reload,
  });
  const p = editor.problems;
  const sections: RecordSection[] = [
    {
      title: 'Cadastro',
      fields: [
        { label: 'Nome', value: <strong>{e.title}</strong>, input: <TextInput editor={editor} k="title" maxLength={120} />, problem: p.title },
        { label: 'Tipo', value: EVENT_KIND_LABEL[e.kind] ?? e.kind, input: <SelectInput editor={editor} k="kind" options={EVENT_KIND_OPTIONS} />, problem: p.kind },
        { label: 'Descrição', value: e.description ? <span className="pre">{e.description}</span> : null, input: <TextArea editor={editor} k="description" maxLength={2000} rows={4} />, wide: true, problem: p.description },
        { label: 'Hashtags', value: e.tags.length > 0 ? e.tags.map((t) => <Badge key={t}>#{t}</Badge>) : null, input: <TextInput editor={editor} k="tags" placeholder="#samba #rodadesamba" />, hint: 'Separe com espaço ou vírgula.', problem: p.tags, wide: true },
        { label: 'Capa (endereço)', value: e.imageUrl ? <a href={e.imageUrl} target="_blank" rel="noopener noreferrer" className="clip">{e.imageUrl}</a> : null, input: <TextInput editor={editor} k="imageUrl" type="url" placeholder="https://" />, hint: 'Vazio tira a capa.', problem: p.imageUrl, wide: true },
      ],
    },
    {
      title: 'Quando e entrada',
      fields: [
        { label: 'Início', value: formatDateTime(e.startsAt), input: <DateTimeInput editor={editor} k="startsAt" />, problem: p.startsAt },
        { label: 'Fim', value: formatDateTime(e.endsAt), input: <DateTimeInput editor={editor} k="endsAt" />, problem: p.endsAt },
        { label: 'Duração', value: formatDuration(e.startsAt, e.endsAt) },
        { label: 'Grátis', value: <YesNo value={e.isFree} />, input: <CheckInput editor={editor} k="isFree" label="Entrada grátis" /> },
        { label: 'Link do ingresso', value: e.ticketUrl ? <a href={e.ticketUrl} target="_blank" rel="noopener noreferrer" className="clip">{e.ticketUrl}</a> : null, input: <TextInput editor={editor} k="ticketUrl" type="url" placeholder="https://" />, problem: p.ticketUrl, wide: true },
      ],
    },
    {
      title: 'Local',
      fields: [
        { label: 'Local', value: <RecordLink kind="venue" id={e.venue.id}>{e.venue.name}</RecordLink> },
        { label: 'Endereço', value: e.venue.address },
        { label: 'Responsável pelo local', value: e.venue.owner ? <PersonLink id={e.venue.owner.id} username={e.venue.owner.username} /> : <span className="muted">Sem responsável</span> },
      ],
    },
    {
      title: 'Gestão',
      fields: [
        { label: 'Quem publica no feed', value: x ? FEED_POLICY_LABEL[x.feedPolicy] : null, input: <SelectInput editor={editor} k="feedPolicy" options={FEED_OPTIONS} />, problem: p.feedPolicy },
        { label: 'Dado de teste', value: <YesNo value={e.isSample} />, input: <CheckInput editor={editor} k="isSample" label="Marcar como teste (nunca aparece como real)" /> },
        { label: 'Veio do Hunter', value: x?.hunterRef ? <Mono>{x.hunterRef}</Mono> : x ? 'Não' : null },
        { label: 'Chapelaria', value: x?.cloakroom ? `${x.cloakroom.enabled ? 'Ligada' : 'Desligada'} · ${x.cloakroom.priceCents === null ? 'grátis' : formatCents(x.cloakroom.priceCents)}${x.cloakroom.capacity !== null ? ` · até ${x.cloakroom.capacity} itens` : ''}` : x ? 'Não configurada' : null },
        { label: 'Lista de nomes', value: x?.guestList ? `${x.guestList.limit === null ? 'sem limite' : `até ${x.guestList.limit} nomes`} · ${x.guestList.maxCompanions} acompanhante(s)${x.guestList.closesAt ? ` · fecha ${formatDateTime(x.guestList.closesAt)}` : ''}` : x ? 'Não tem' : null },
        { label: 'Criado em', value: x ? formatDateTime(x.createdAt) : null },
        { label: 'Atualizado em', value: x ? formatDateTime(x.updatedAt) : null },
        { label: 'ID', value: <Mono>{e.id}</Mono> },
      ],
    },
    {
      title: 'Números',
      fields: [
        { label: 'Confirmados', value: e.goingCount },
        { label: 'Stories', value: x?.counts.stories },
        { label: 'Publicações no feed', value: x?.counts.feedPosts },
        { label: 'Posts que citam', value: x?.counts.posts },
        { label: 'Encontros marcados', value: x?.counts.meetings },
        { label: 'Fichas da chapelaria', value: x?.counts.cloakroomTickets },
      ],
    },
    {
      title: 'Outras datas com este nome',
      count: e.sameTitleTotal - 1,
      hidden: e.sameTitle.length === 0,
      children: (
        <>
          <LinkedList
            items={e.sameTitle}
            empty=""
            keyOf={(o) => o.id}
            render={(o) => ({
              main: (
                <button type="button" className="linkbtn" onClick={() => onOpenDate(o.id)}>
                  {formatEventWhen(o.startsAt, o.endsAt)}
                </button>
              ),
              side: o.upcoming ? 'Por vir' : 'Já passou',
              past: !o.upcoming,
            })}
          />
          {e.sameTitleTotal - 1 > e.sameTitle.length ? <p className="muted small">Mostrando as {e.sameTitle.length} datas mais próximas desta.</p> : null}
        </>
      ),
    },
    {
      title: 'Quem confirmou',
      count: e.goingCount,
      children: (
        <LinkedList
          items={e.going}
          total={e.goingCount}
          empty="Ninguém confirmou ainda."
          keyOf={(g) => g.id}
          render={(g) => ({ main: <PersonLink id={g.id} username={g.username} displayName={g.displayName} />, side: formatDateTime(g.at) })}
        />
      ),
    },
  ];
  const when = formatEventWhen(e.startsAt, e.endsAt);
  return (
    <RecordView
      title={e.title}
      subtitle={`${when} · ${e.venue.name}`}
      status={
        <>
          <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge> <Badge>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</Badge> {e.isFree ? <Badge tone="ok">Grátis</Badge> : null}{' '}
          {e.isSample ? <Badge>Teste</Badge> : null} {e.sameTitleTotal > 1 ? <Badge tone="warn">{e.sameTitleTotal} datas com este nome</Badge> : null}
        </>
      }
      media={e.imageUrl ? <img className="eventdetail__cover" src={e.imageUrl} alt="" referrerPolicy="no-referrer" /> : undefined}
      links={
        <>
          <a href={appUrl(`/eventos/${encodeURIComponent(e.id)}`)} target="_blank" rel="noopener noreferrer">
            Abrir no app
          </a>
          <a href={appUrl(`/bares/${encodeURIComponent(e.venue.id)}`)} target="_blank" rel="noopener noreferrer">
            Página do local
          </a>
        </>
      }
      sections={sections}
      actions={[{ label: 'Apagar', danger: true, confirm: deleteEventAction(e.id, e.title, when) }]}
      editor={editor}
      editHint="As mesmas regras de quem administra o local: o início pode ficar como está mesmo que já tenha passado. O que mudou fica na auditoria."
      onClose={onClose}
      onChanged={onClose}
    />
  );
}

export function deleteEventAction(id: string, title: string, when: string): ActionSpec {
  return {
    title: `Apagar “${title}” de ${when}`,
    description: <p>O evento some do Explorar e das páginas de quem já o viu. As outras datas com o mesmo nome continuam. Isso não pode ser desfeito.</p>,
    confirmLabel: 'Apagar evento',
    danger: true,
    noteLabel: 'Motivo',
    noteRequired: true,
    run: (note) => api.deletePlaceEvent(id, note),
  };
}

/** Mesmo local + mesmo nome (sem diferenciar maiúsculas): o mesmo evento em outra data. */
const titleKey = (e: PlaceEventRow) => `${e.venue.id}|${e.title.trim().toLocaleLowerCase('pt-BR')}`;

type EventSort = 'title' | 'venue' | 'startsAt' | 'kind';

export function EventsPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<EventSort>();
  const onSort = (column: EventSort, first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.placeEvents({ q, offset, sort }), [q, offset, sort]);
  useReloadOnChange(list.reload);
  const openRecord = useOpenRecord();
  const setOpenId = (id: string) => openRecord({ kind: 'event', id });
  return (
    <>
      <PageHead title="Eventos" hint="Eventos de locais. Os eventos criados por pessoas aparecem em Posts (filtro “só eventos”).">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar por evento ou local…" label="Buscar evento" />
      </PageHead>
      <Loadable state={list} empty="Nenhum evento encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => {
          // Eventos semanais repetem o nome: conta quantas vezes cada um aparece nesta página para avisar.
          const titleCount = new Map<string, number>();
          for (const e of page.items) titleCount.set(titleKey(e), (titleCount.get(titleKey(e)) ?? 0) + 1);
          return (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <SortTh label="Evento" column="title" sort={sort} onSort={onSort} />
                    <SortTh label="Local" column="venue" sort={sort} onSort={onSort} />
                    <SortTh label="Quando" column="startsAt" sort={sort} onSort={onSort} first="desc" />
                    <SortTh label="Tipo" column="kind" sort={sort} onSort={onSort} />
                    <th className="num">Confirmados</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((e) => {
                    const status = eventStatus(e.startsAt, e.endsAt);
                    const when = formatEventWhen(e.startsAt, e.endsAt);
                    const repeats = (titleCount.get(titleKey(e)) ?? 0) > 1;
                    return (
                      <tr key={e.id} className={status === 'PAST' ? 'is-past' : undefined}>
                        <td>
                          <button type="button" className="linkbtn" onClick={() => setOpenId(e.id)} aria-label={`Abrir o detalhe de ${e.title}, ${when}`}>
                            <strong>{e.title}</strong>
                          </button>{' '}
                          {status === 'LIVE' ? <Badge tone="ok">Agora</Badge> : null} {e.isFree ? <Badge tone="ok">Grátis</Badge> : null} {e.isSample ? <Badge>Teste</Badge> : null}
                          {repeats ? <div className="muted small">Mesmo nome mais de uma vez nesta página: veja a data</div> : null}
                        </td>
                        <td>
                          {e.venue.name}
                          {e.venue.address ? <div className="muted small">{e.venue.address}</div> : null}
                        </td>
                        <td>
                          <span className="nowrap">{when}</span>
                          <div className="muted small">
                            {STATUS_LABEL[status]} · {formatDuration(e.startsAt, e.endsAt)}
                          </div>
                        </td>
                        <td>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</td>
                        <td className="num">{e.goingCount}</td>
                        <td className="right">
                          <button type="button" className="btn btn--small" onClick={() => setOpenId(e.id)}>
                            Detalhes
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn--small btn--danger-quiet"
                            onClick={() => setAction(deleteEventAction(e.id, e.title, when))}
                          >
                            Apagar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
            </>
          );
        }}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
