import { useState } from 'react';
import { api, appUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { CLAIM_LABEL, EVENT_KIND_LABEL, FEED_POLICY_LABEL, formatDate, formatDateTime, formatEventWhen, plural } from '../labels.ts';
import type { FeedPolicy, VenueDetail } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';
import { CheckInput, LinkedList, Mono, NumberInput, PersonLink, RecordLink, RecordModal, RecordView, SelectInput, TextArea, TextInput, YesNo, useOpenRecord, useRecordEditor, useReloadOnChange } from '../record.tsx';
import type { RecordSection } from '../record.tsx';
import { AuditTrail } from './audit.tsx';

const SOURCE_LABEL = { GOOGLE: 'Google', OSM: 'OpenStreetMap', IMPORT: 'Importação de agenda' } as const;

type VenueEvent = VenueDetail['events'][number];

type VenueDraft = {
  name: string;
  address: string;
  category: string;
  description: string;
  imageUrl: string;
  logoUrl: string;
  instagram: string;
  lat: string;
  lng: string;
  isSample: boolean;
  feedPolicy: FeedPolicy;
};

const FEED_OPTIONS = (Object.keys(FEED_POLICY_LABEL) as FeedPolicy[]).map((value) => ({ value, label: FEED_POLICY_LABEL[value] }));
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Horários (JSON de 7 posições, domingo a sábado) em texto: "Seg 18:00–02:00 · Ter fechado". */
function hoursText(json: string | null): string | null {
  if (!json) return null;
  try {
    const days = JSON.parse(json) as ({ open: string; close: string } | null)[];
    if (!Array.isArray(days)) return null;
    return days.map((d, i) => `${WEEKDAYS[i] ?? i} ${d ? `${d.open}–${d.close}` : 'fechado'}`).join(' · ');
  } catch {
    return null;
  }
}

const coordProblem = (v: string, max: number, label: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) || Math.abs(n) > max ? `${label} entre -${max} e ${max}` : undefined;
};

/** Detalhe do local: capa e logo, cadastro, origem, equipe, pedidos, seguidores e eventos. "Editar" corrige o cadastro. */
function VenueDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAsync(() => api.venue(id), [id]);
  return (
    <RecordModal state={detail} label="Local" onClose={onClose}>
      {(v) => <VenueRecord v={v} onClose={onClose} reload={detail.reload} />}
    </RecordModal>
  );
}

export { VenueDetailModal as VenueDetail };

function VenueRecord({ v, onClose, reload }: { v: VenueDetail; onClose: () => void; reload: () => void }) {
  const x = v.extra;
  const editor = useRecordEditor<VenueDraft>({
    initial: {
      name: v.name, address: v.address ?? '', category: v.category ?? '', description: v.description ?? '', imageUrl: v.coverUrl ?? '', logoUrl: v.logoUrl ?? '', instagram: v.instagram ? `@${v.instagram}` : '',
      lat: String(v.lat), lng: String(v.lng), isSample: v.isSample, feedPolicy: x?.feedPolicy ?? 'OWNER_ONLY',
    },
    check: (d) => {
      const lat = coordProblem(d.lat, 90, 'Latitude');
      const lng = coordProblem(d.lng, 180, 'Longitude');
      return { ...(d.name.trim().length < 2 ? { name: 'O nome precisa de pelo menos 2 caracteres' } : {}), ...(lat ? { lat } : {}), ...(lng ? { lng } : {}) };
    },
    save: (c, note) => {
      const opt = (t: string) => (t.trim() === '' ? null : t.trim());
      return api.editVenue(
        v.id,
        {
          ...(c.name !== undefined ? { name: c.name.trim() } : {}),
          ...(c.address !== undefined ? { address: opt(c.address) } : {}),
          ...(c.category !== undefined ? { category: opt(c.category) } : {}),
          ...(c.description !== undefined ? { description: c.description.trim() === '' ? null : c.description } : {}),
          ...(c.imageUrl !== undefined ? { imageUrl: opt(c.imageUrl) } : {}),
          ...(c.logoUrl !== undefined ? { logoUrl: opt(c.logoUrl) } : {}),
          ...(c.instagram !== undefined ? { instagram: opt(c.instagram) } : {}),
          ...(c.lat !== undefined ? { lat: Number(c.lat.replace(',', '.')) } : {}),
          ...(c.lng !== undefined ? { lng: Number(c.lng.replace(',', '.')) } : {}),
          ...(c.isSample !== undefined ? { isSample: c.isSample } : {}),
          ...(c.feedPolicy !== undefined ? { feedPolicy: c.feedPolicy } : {}),
        },
        note,
      );
    },
    onSaved: reload,
  });
  const p = editor.problems;
  const upcoming = v.events.filter((e) => e.upcoming);
  const past = v.events.filter((e) => !e.upcoming);
  const eventItem = (e: VenueEvent) => ({
    main: (
      <>
        <RecordLink kind="event" id={e.id}>
          <strong>{e.title}</strong>
        </RecordLink>{' '}
        {e.isSample ? <Badge>Teste</Badge> : null} {e.isFree ? <Badge tone="ok">Grátis</Badge> : null}
      </>
    ),
    side: `${formatEventWhen(e.startsAt, e.endsAt)}${EVENT_KIND_LABEL[e.kind] ? ` · ${EVENT_KIND_LABEL[e.kind]}` : ''}`,
    past: !e.upcoming,
  });

  const sections: RecordSection[] = [
    {
      title: 'Cadastro',
      fields: [
        { label: 'Nome', value: <strong>{v.name}</strong>, input: <TextInput editor={editor} k="name" maxLength={80} />, problem: p.name },
        { label: 'Tipo', value: v.category, input: <TextInput editor={editor} k="category" maxLength={40} placeholder="bar, balada, casa de shows…" />, problem: p.category },
        { label: 'Endereço', value: v.address, input: <TextInput editor={editor} k="address" maxLength={200} />, problem: p.address, wide: true },
        { label: 'Descrição', value: v.description ? <span className="pre">{v.description}</span> : null, input: <TextArea editor={editor} k="description" maxLength={1000} rows={4} />, wide: true, problem: p.description },
        {
          label: 'Instagram',
          value: v.instagram ? (
            <a href={`https://www.instagram.com/${encodeURIComponent(v.instagram)}/`} target="_blank" rel="noopener noreferrer">
              @{v.instagram}
            </a>
          ) : null,
          input: <TextInput editor={editor} k="instagram" maxLength={120} placeholder="@bardoze ou link do perfil" />,
          hint: 'Vazio tira o Instagram.',
          problem: p.instagram,
        },
        { label: 'Horários', value: hoursText(x?.hoursJson ?? null), wide: true },
        { label: 'Capa (endereço)', value: v.coverUrl ? <span className="clip mono small">{v.coverUrl}</span> : null, input: <TextInput editor={editor} k="imageUrl" type="url" placeholder="https://" />, hint: 'Vazio tira a capa.', problem: p.imageUrl, wide: true },
        { label: 'Logo (endereço)', value: v.logoUrl ? <span className="clip mono small">{v.logoUrl}</span> : null, input: <TextInput editor={editor} k="logoUrl" type="url" placeholder="https://" />, hint: 'Vazio tira a logo.', problem: p.logoUrl, wide: true },
      ],
    },
    {
      title: 'Posição e origem',
      fields: [
        { label: 'Latitude', value: v.lat.toFixed(6), input: <NumberInput editor={editor} k="lat" />, problem: p.lat },
        { label: 'Longitude', value: v.lng.toFixed(6), input: <NumberInput editor={editor} k="lng" />, problem: p.lng },
        { label: 'Entrou por', value: v.source ? SOURCE_LABEL[v.source] : 'Cadastro no app' },
        { label: 'Chave externa', value: x?.externalKey ? <Mono>{x.externalKey}</Mono> : null },
        { label: 'Foto do Google', value: x?.photoRef ? `Sim${x.photoAuthor ? ` · crédito: ${x.photoAuthor}` : ''}` : x ? 'Não' : null },
        { label: 'Organização', value: <YesNo value={v.isOrganization} /> },
        { label: 'Criado no app', value: <YesNo value={v.isUserCreated} /> },
      ],
    },
    {
      title: 'Gestão',
      fields: [
        { label: 'Responsável', value: v.owner ? <PersonLink id={v.owner.id} username={v.owner.username} displayName={v.owner.displayName} /> : <span className="muted">Ninguém</span> },
        { label: 'Quem publica no feed', value: x ? FEED_POLICY_LABEL[x.feedPolicy] : null, input: <SelectInput editor={editor} k="feedPolicy" options={FEED_OPTIONS} /> },
        { label: 'Dado de teste', value: <YesNo value={v.isSample} />, input: <CheckInput editor={editor} k="isSample" label="Marcar como teste (nunca aparece como real)" /> },
        { label: 'Criado em', value: x ? formatDateTime(x.createdAt) : null },
        { label: 'Atualizado em', value: x ? formatDateTime(x.updatedAt) : null },
        { label: 'ID', value: <Mono>{v.id}</Mono> },
      ],
    },
    {
      title: 'Números',
      fields: [
        { label: 'Seguidores', value: v.followers },
        { label: 'Eventos', value: `${v.eventsTotal} (${v.upcomingCount} por vir)` },
        { label: 'Nota', value: x ? (x.rating.average === null ? 'Sem avaliações' : `${x.rating.average.toLocaleString('pt-BR')} ★ · ${plural(x.rating.count, 'avaliação', 'avaliações')}`) : null },
        { label: 'Check-ins', value: x?.counts.checkins },
        { label: 'Posts do local', value: x?.counts.posts },
        { label: 'Publicações no feed', value: x?.counts.feedPosts },
        { label: 'Stories', value: x?.counts.stories },
        { label: 'Pedidos de dono', value: x?.counts.claims },
        { label: 'Ofertas', value: x?.counts.offers },
        { label: 'Impulsionamentos', value: x?.counts.boosts },
        { label: 'Conversas', value: x?.counts.conversations },
      ],
    },
    {
      title: 'Equipe',
      count: x?.managers.length,
      hidden: !x,
      children: x ? (
        <LinkedList
          items={x.managers}
          empty="Ninguém além do responsável."
          keyOf={(m) => m.id}
          render={(m) => ({ main: <PersonLink id={m.id} username={m.username} displayName={m.displayName} />, side: `${m.status === 'ACCEPTED' ? 'Administra' : 'Convite pendente'} · ${formatDate(m.at)}` })}
        />
      ) : null,
    },
    {
      title: 'Pedidos para administrar',
      count: x?.claims.length,
      hidden: !x || x.claims.length === 0,
      children: x ? (
        <LinkedList
          items={x.claims}
          empty=""
          keyOf={(c) => c.id}
          render={(c) => ({ main: <PersonLink id={c.userId} username={c.username} />, side: `${CLAIM_LABEL[c.status]} · ${formatDate(c.createdAt)}${c.reviewedAt ? ` · decidido ${formatDate(c.reviewedAt)}` : ''}` })}
        />
      ) : null,
    },
    {
      title: 'Seguidores',
      count: v.followers,
      hidden: !x,
      children: x ? (
        <LinkedList
          items={x.followersSample}
          total={v.followers}
          empty="Ninguém segue ainda."
          keyOf={(f) => f.id}
          render={(f) => ({ main: <PersonLink id={f.id} username={f.username} displayName={f.displayName} />, side: `desde ${formatDate(f.at)}` })}
        />
      ) : null,
    },
    {
      title: 'Eventos por vir',
      count: v.upcomingCount,
      children: (
        <>
          <LinkedList items={upcoming} empty="Nenhum evento por vir." keyOf={(e) => e.id} render={eventItem} />
          {v.upcomingCount > upcoming.length ? <p className="muted small">Mostrando os {upcoming.length} mais próximos.</p> : null}
        </>
      ),
    },
    {
      title: 'Eventos que já passaram',
      count: v.eventsTotal - v.upcomingCount,
      hidden: past.length === 0,
      children: (
        <>
          <LinkedList items={past} empty="" keyOf={(e) => e.id} render={eventItem} />
          {v.eventsTotal - v.upcomingCount > past.length ? <p className="muted small">Mostrando os {past.length} mais recentes.</p> : null}
        </>
      ),
    },
    { title: 'Auditoria', children: <AuditTrail filter={{ targetId: v.id }} empty="Nada registrado sobre este local." /> },
  ];

  return (
    <RecordView
      title={v.name}
      subtitle={v.address ?? 'Sem endereço'}
      status={
        <>
          {v.owner ? <Badge tone="ok">Com responsável</Badge> : <Badge tone="warn">Sem responsável</Badge>} {v.isOrganization ? <Badge tone="info">Organização</Badge> : null}{' '}
          {v.isUserCreated ? <Badge tone="info">Criado no app</Badge> : null} {v.isSample ? <Badge>Teste</Badge> : null}
        </>
      }
      media={
        v.coverUrl || v.logoUrl ? (
          <div className={v.logoUrl ? 'venuehead venuehead--logo' : 'venuehead'}>
            {v.coverUrl ? <img className="venuehead__cover" src={v.coverUrl} alt="" referrerPolicy="no-referrer" /> : <div className="venuehead__cover venuehead__cover--empty" />}
            {v.logoUrl ? <img className="venuehead__logo" src={v.logoUrl} alt={`Logo de ${v.name}`} referrerPolicy="no-referrer" /> : null}
          </div>
        ) : undefined
      }
      links={
        <>
          <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">
            Ver no mapa
          </a>
          <a href={appUrl(`/bares/${encodeURIComponent(v.id)}`)} target="_blank" rel="noopener noreferrer">
            Abrir no app
          </a>
        </>
      }
      sections={sections}
      actions={[{ label: 'Tirar responsável', danger: true, hidden: !v.owner, confirm: removeOwnerAction(v.id, v.name, v.owner?.username ?? '') }]}
      editor={editor}
      editHint="Corrige o que o dono edita e o que só a gestão troca (posição, teste, feed). Horários, fotos enviadas e equipe continuam com o dono. O que mudou fica na auditoria."
      onClose={onClose}
      onChanged={reload}
    />
  );
}

function removeOwnerAction(id: string, name: string, username: string): ActionSpec {
  return {
    title: `Tirar o responsável de ${name}`,
    description: <p>@{username} deixa de administrar o local e perde o acesso ao painel dele. Os eventos já criados continuam.</p>,
    confirmLabel: 'Tirar responsável',
    danger: true,
    noteLabel: 'Motivo',
    noteRequired: true,
    run: (note) => api.removeOwner(id, note),
  };
}

type VenueSort = 'name' | 'category' | 'owner' | 'events';

export function VenuesPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<VenueSort>();
  const onSort = (column: VenueSort, first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.venues({ q, offset, sort }), [q, offset, sort]);
  useReloadOnChange(list.reload);
  const openRecord = useOpenRecord();
  const setOpenId = (id: string) => openRecord({ kind: 'venue', id });
  return (
    <>
      <PageHead title="Locais" hint="Rolês cadastrados: bares, baladas e casas. Tire o responsável se o pedido foi indevido.">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar por nome ou endereço…" label="Buscar local" />
      </PageHead>
      <Loadable state={list} empty="Nenhum local encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Local" column="name" sort={sort} onSort={onSort} />
                  <SortTh label="Tipo" column="category" sort={sort} onSort={onSort} />
                  <SortTh label="Responsável" column="owner" sort={sort} onSort={onSort} />
                  <SortTh label="Eventos" column="events" sort={sort} onSort={onSort} first="desc" className="num" />
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button type="button" className="linkbtn" onClick={() => setOpenId(v.id)} aria-label={`Abrir o detalhe de ${v.name}`}>
                        <strong>{v.name}</strong>
                      </button>{' '}
                      {v.isSample ? <Badge>Teste</Badge> : null}
                      <div className="muted small">{v.address ?? 'Sem endereço'}</div>
                    </td>
                    <td>{v.category ?? '—'}</td>
                    <td>{v.owner ? <span className="handle">@{v.owner.username}</span> : <span className="muted">Sem responsável</span>}</td>
                    <td className="num" title={plural(v.eventsCount, 'evento', 'eventos')}>{v.eventsCount}</td>
                    <td className="right">
                      <button type="button" className="btn btn--small" onClick={() => setOpenId(v.id)}>
                        Detalhes
                      </button>{' '}
                      {v.owner ? (
                        <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => setAction(removeOwnerAction(v.id, v.name, v.owner?.username ?? ''))}>
                          Tirar responsável
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
