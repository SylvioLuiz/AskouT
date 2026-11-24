import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useOptionalUser } from '../auth.tsx';
import { api } from '../client.ts';
import { prepareImage } from '../lib/chat-media.ts';
import { toApiError } from '../lib/errors.ts';
import { balanceLabel, centsToInput, EXPENSE_ACCEPT, expenseFileCheck, formatCents, parseMoney, shoppingSummary } from '../lib/event-shopping.ts';
import { t } from '../lib/i18n/index.ts';
import { openDocument } from '../lib/save-file.ts';
import type { EventExpense, EventShoppingView, ShoppingItem } from '../lib/types.ts';
import { Sheet } from './agenda.tsx';
import { CheckIcon, DocIcon, EditIcon, ListIcon, PlusIcon, TrashIcon } from './icons.tsx';
import { Avatar, Button, Confirm, Notice } from './ui.tsx';

type Tab = 'list' | 'split';

/**
 * Lista de compras e divisão de gastos na página de um evento criado por uma pessoa (nunca de local). Quem criou o
 * evento liga; quem está no grupo do evento usa. Some para quem não participa.
 */
export function EventShoppingCard({ eventId, ended }: { eventId: string; ended: boolean }) {
  const [view, setView] = useState<EventShoppingView | undefined>();
  const [open, setOpen] = useState<Tab | undefined>();
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    let live = true;
    api.eventShopping(eventId).then((v) => live && setView(v)).catch(() => live && setView(undefined));
    return () => {
      live = false;
    };
  }, [eventId]);

  if (!view || !view.supported || !view.isMember) return null;
  if (!view.enabled && !view.isOwner) return null;

  if (!view.enabled) {
    return (
      <section className="evshop" aria-label={t('Lista de compras')}>
        <h2 className="evinfo__title">{t('Lista de compras')}</h2>
        <p className="muted">{t('Monte a lista do que comprar com o pessoal do grupo e, depois do evento, divida os gastos com as notas fiscais.')}</p>
        <Button full variant="secondary" onClick={() => setSettings(true)}>
          <ListIcon /> {t('Ligar lista de compras')}
        </Button>
        {settings ? <ShoppingSettings eventId={eventId} view={view} onChanged={setView} onClose={() => setSettings(false)} /> : null}
      </section>
    );
  }

  const total = view.split?.totalCents ?? 0;
  return (
    <section className="evshop" aria-label={t('Lista de compras')}>
      <div className="evshop__head">
        <h2 className="evinfo__title">{t('Lista de compras')}</h2>
        {view.isAdmin ? (
          <button type="button" className="evshop__gear" onClick={() => setSettings(true)} aria-label={t('Configurar lista de compras')}>
            <EditIcon />
          </button>
        ) : null}
      </div>
      {!view.hasGroup && view.isOwner ? <p className="muted evshop__hint">{t('Crie o grupo do evento para os convidados verem e usarem a lista.')}</p> : null}
      <div className="evshop__cards">
        <button type="button" className="evshop__card" onClick={() => setOpen('list')}>
          <strong>{t('Lista')}</strong>
          <span className="muted">{shoppingSummary(view)}</span>
        </button>
        <button type="button" className="evshop__card" onClick={() => setOpen('split')}>
          <strong>{t('Divisão de gastos')}</strong>
          <span className="muted">{total > 0 ? formatCents(total) : ended ? t('Anexe as notas') : t('Depois do evento')}</span>
        </button>
      </div>
      {open ? <ShoppingSheet eventId={eventId} view={view} tab={open} onTab={setOpen} onChanged={setView} onClose={() => setOpen(undefined)} /> : null}
      {settings ? <ShoppingSettings eventId={eventId} view={view} onChanged={setView} onClose={() => setSettings(false)} /> : null}
    </section>
  );
}

/** Ligar, permissões de quem participa e desligar (só quem criou o evento liga e desliga). */
function ShoppingSettings({ eventId, view, onChanged, onClose }: { eventId: string; view: EventShoppingView; onChanged: (v: EventShoppingView) => void; onClose: () => void }) {
  const [canAdd, setCanAdd] = useState(view.settings?.membersCanAdd ?? true);
  const [canCheck, setCanCheck] = useState(view.settings?.membersCanCheck ?? true);
  const [busy, setBusy] = useState(false);
  const [askOff, setAskOff] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function run(input: { enabled?: boolean; membersCanAdd?: boolean; membersCanCheck?: boolean }, close: boolean) {
    setBusy(true);
    setProblem(undefined);
    try {
      onChanged(await api.configureShopping(eventId, input));
      if (close) onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const row = (id: string, title: string, help: string, value: boolean, set: (v: boolean) => void) => (
    <div className="evshop__setting">
      <span className="evshop__settingtext">
        <strong id={id}>{title}</strong>
        <span className="muted">{help}</span>
      </span>
      <button type="button" role="switch" aria-checked={value} aria-labelledby={id} className="switch" disabled={busy} onClick={() => set(!value)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );

  return (
    <Sheet title={t('Lista de compras')} onClose={onClose}>
      <div className="evshop__manage">
        <p className="muted">{t('Quem administra o evento sempre cria itens, informa os valores e quem pagou. Escolha o que os outros participantes do grupo podem fazer.')}</p>
        {row('shop-add', t('Criar e acrescentar itens'), t('Os participantes podem pôr itens na lista.'), canAdd, setCanAdd)}
        {row('shop-check', t('Marcar como comprado'), t('Os participantes podem marcar o que já compraram.'), canCheck, setCanCheck)}
        <p className="muted">{t('Na divisão, qualquer participante pode anexar notas fiscais e recibos.')}</p>
        <Button full loading={busy} onClick={() => void run({ enabled: true, membersCanAdd: canAdd, membersCanCheck: canCheck }, true)}>
          {view.enabled ? t('Salvar') : t('Ligar lista de compras')}
        </Button>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {view.enabled && view.isOwner ? (
          askOff ? (
            <Confirm danger question={t('Desligar apaga a lista, os anexos e a divisão. Continuar?')} confirmLabel={t('Desligar')} busy={busy} onConfirm={() => void run({ enabled: false }, true)} onCancel={() => setAskOff(false)} />
          ) : (
            <Button full variant="danger" disabled={busy} onClick={() => setAskOff(true)}>{t('Desligar lista de compras')}</Button>
          )
        ) : null}
      </div>
    </Sheet>
  );
}

function ShoppingSheet({ eventId, view, tab, onTab, onChanged, onClose }: { eventId: string; view: EventShoppingView; tab: Tab; onTab: (t: Tab) => void; onChanged: (v: EventShoppingView) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function run(job: () => Promise<EventShoppingView>): Promise<boolean> {
    setBusy(true);
    setProblem(undefined);
    try {
      onChanged(await job());
      return true;
    } catch (failure) {
      setProblem(toApiError(failure).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Lista de compras')} onClose={onClose}>
      <div className="segtabs segtabs--fill evshop__tabs" role="tablist" aria-label={t('Lista de compras')}>
        <button type="button" role="tab" aria-selected={tab === 'list'} className="segtabs__tab" onClick={() => onTab('list')}>
          {t('Lista')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'split'} className="segtabs__tab" onClick={() => onTab('split')}>
          {t('Divisão')}
        </button>
      </div>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {tab === 'list' ? <ListTab eventId={eventId} view={view} busy={busy} run={run} /> : <SplitTab eventId={eventId} view={view} busy={busy} run={run} onProblem={setProblem} />}
    </Sheet>
  );
}

type Run = (job: () => Promise<EventShoppingView>) => Promise<boolean>;

function ListTab({ eventId, view, busy, run }: { eventId: string; view: EventShoppingView; busy: boolean; run: Run }) {
  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('');
  const [editing, setEditing] = useState<string | undefined>();

  async function add(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === '') return;
    if (await run(() => api.addShoppingItem(eventId, { title, quantity: quantity.trim() || null }))) {
      setTitle('');
      setQuantity('');
    }
  }

  const pending = view.items.filter((i) => i.boughtAt === null);
  const bought = view.items.filter((i) => i.boughtAt !== null);
  return (
    <div className="evshop__body">
      {view.canAdd ? (
        <form className="evshop__add" onSubmit={(e) => void add(e)}>
          <input className="evshop__input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Item (ex.: carvão)')} aria-label={t('Item')} maxLength={80} />
          <input className="evshop__input evshop__input--qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={t('Qtd.')} aria-label={t('Quantidade')} maxLength={30} />
          <button type="submit" className="evshop__addbtn" disabled={busy || title.trim() === ''} aria-label={t('Adicionar item')}>
            <PlusIcon />
          </button>
        </form>
      ) : (
        <p className="muted evshop__hint">{t('Só quem administra o evento acrescenta itens.')}</p>
      )}
      {view.items.length === 0 ? <p className="muted">{t('A lista está vazia.')}</p> : null}
      <ul className="evshop__items">
        {[...pending, ...bought].map((item) =>
          editing === item.id ? (
            <ItemEditor key={item.id} item={item} busy={busy} onCancel={() => setEditing(undefined)} onSave={async (patch) => {
              if (await run(() => api.updateShoppingItem(eventId, item.id, patch))) setEditing(undefined);
            }} />
          ) : (
            <li key={item.id} className={`evshop__item${item.boughtAt ? ' evshop__item--done' : ''}`}>
              <button
                type="button"
                className="evshop__check"
                role="checkbox"
                aria-checked={item.boughtAt !== null}
                aria-label={item.boughtAt ? t('Desmarcar {item}', { item: item.title }) : t('Marcar {item} como comprado', { item: item.title })}
                disabled={busy || !view.canCheck}
                onClick={() => void run(() => api.updateShoppingItem(eventId, item.id, { bought: item.boughtAt === null }))}
              >
                {item.boughtAt ? <CheckIcon /> : null}
              </button>
              <span className="evshop__itemtext">
                <span className="evshop__itemtitle">{item.title}{item.quantity ? <span className="muted"> · {item.quantity}</span> : null}</span>
                <span className="evshop__itemmeta muted">
                  {item.boughtBy ? t('Comprado por {name}', { name: item.boughtBy.displayName }) : item.createdBy ? t('Pôs na lista: {name}', { name: item.createdBy.displayName }) : ''}
                </span>
              </span>
              {item.canEdit ? (
                <>
                  <button type="button" className="evshop__icon" onClick={() => setEditing(item.id)} aria-label={t('Editar {item}', { item: item.title })} disabled={busy}>
                    <EditIcon />
                  </button>
                  <button type="button" className="evshop__icon" onClick={() => void run(() => api.deleteShoppingItem(eventId, item.id))} aria-label={t('Apagar {item}', { item: item.title })} disabled={busy}>
                    <TrashIcon />
                  </button>
                </>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function ItemEditor({ item, busy, onSave, onCancel }: { item: ShoppingItem; busy: boolean; onSave: (patch: { title: string; quantity: string | null }) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [quantity, setQuantity] = useState(item.quantity ?? '');
  return (
    <li className="evshop__item">
      <form className="evshop__add evshop__add--edit" onSubmit={(e) => { e.preventDefault(); void onSave({ title, quantity: quantity.trim() || null }); }}>
        <input className="evshop__input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('Item')} maxLength={80} autoFocus />
        <input className="evshop__input evshop__input--qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label={t('Quantidade')} placeholder={t('Qtd.')} maxLength={30} />
        <Button small type="submit" loading={busy} disabled={title.trim() === ''}>{t('Salvar')}</Button>
        <Button small variant="quiet" onClick={onCancel}>{t('Cancelar')}</Button>
      </form>
    </li>
  );
}

function SplitTab({ eventId, view, busy, run, onProblem }: { eventId: string; view: EventShoppingView; busy: boolean; run: Run; onProblem: (p: string | undefined) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [manual, setManual] = useState(false);
  const me = useOptionalUser()?.id;
  const split = view.split;
  const members = split?.people ?? [];

  async function attach(file: File) {
    const check = expenseFileCheck(file);
    if ('problem' in check) {
      onProblem(check.problem);
      return;
    }
    let body: Blob = file;
    let type = check.type;
    let name = file.name;
    if (check.kind === 'IMAGE') {
      try {
        body = await prepareImage(file);
        type = 'image/jpeg';
        name = name.replace(/\.[^.]+$/, '') + '.jpg';
      } catch {
        onProblem(t('Não deu para preparar essa foto. Tente outra.'));
        return;
      }
    }
    if (await run(() => api.attachExpense(eventId, body, name, type, note.trim() || undefined))) setNote('');
  }

  const mine = split?.people.find((p) => p.user.userId === me);
  const includedCount = split?.people.filter((p) => p.included).length ?? 0;
  return (
    <div className="evshop__body">
      {split ? (
        <div className="evshop__total">
          <span>
            <span className="muted">{t('Total')}</span>
            <strong>{formatCents(split.totalCents)}</strong>
          </span>
          <span>
            <span className="muted">{t('Por pessoa')}</span>
            <strong>{includedCount > 0 ? formatCents(Math.floor(split.totalCents / includedCount)) : '—'}</strong>
          </span>
          {mine && split.totalCents > 0 ? <span className={`evshop__mine${mine.balanceCents < 0 ? ' evshop__mine--owe' : ''}`}>{balanceLabel(mine.balanceCents, true)}</span> : null}
        </div>
      ) : null}
      {split && split.pendingCount > 0 ? (
        <p className="muted evshop__hint">
          {split.pendingCount === 1 ? t('1 anexo ainda sem valor ou sem quem pagou: não entra na conta.') : t('{n} anexos ainda sem valor ou sem quem pagou: não entram na conta.', { n: split.pendingCount })}
        </p>
      ) : null}

      <div className="evshop__attach">
        <input className="evshop__input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Descrição (opcional, ex.: mercado)')} aria-label={t('Descrição do anexo')} maxLength={120} />
        <Button full variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>
          <DocIcon /> {t('Anexar nota fiscal ou recibo')}
        </Button>
        <input ref={fileRef} type="file" accept={EXPENSE_ACCEPT} hidden onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void attach(file);
        }} />
        {view.isAdmin ? (
          manual ? (
            <ExpenseEditor eventId={eventId} view={view} busy={busy} run={run} onDone={() => setManual(false)} />
          ) : (
            <Button full variant="quiet" onClick={() => setManual(true)}>
              <PlusIcon /> {t('Lançar gasto sem anexo')}
            </Button>
          )
        ) : (
          <p className="muted evshop__hint">{t('Quem administra o evento informa o valor de cada anexo e quem pagou.')}</p>
        )}
      </div>

      {view.expenses.length > 0 ? <h3 className="evshop__subtitle">{t('Gastos')}</h3> : null}
      <ul className="evshop__expenses">
        {view.expenses.map((expense) => (
          <ExpenseRow key={expense.id} eventId={eventId} view={view} expense={expense} busy={busy} run={run} onProblem={onProblem} />
        ))}
      </ul>

      {split && split.totalCents > 0 ? (
        <>
          <h3 className="evshop__subtitle">{t('Quem paga quem')}</h3>
          {split.transfers.length === 0 ? <p className="muted">{t('Ninguém deve nada.')}</p> : null}
          <ul className="evshop__transfers">
            {split.transfers.map((tr) => (
              <li key={`${tr.from.userId}-${tr.to.userId}`}>
                {t('{from} paga {value} para {to}', { from: tr.from.userId === me ? t('Você') : tr.from.displayName, to: tr.to.userId === me ? t('você') : tr.to.displayName, value: formatCents(tr.amountCents) })}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {split ? (
        <>
          <h3 className="evshop__subtitle">{t('Pessoas na divisão')}</h3>
          <ul className="evshop__people">
            {members.map((p) => (
              <li key={p.user.userId} className="evshop__person">
                <Avatar profile={p.user} size={32} />
                <span className="evshop__itemtext">
                  <span className="evshop__itemtitle">{p.user.userId === me ? t('Você') : p.user.displayName}</span>
                  <span className="muted evshop__itemmeta">
                    {p.included ? t('Pagou {paid} · parte {share}', { paid: formatCents(p.paidCents), share: formatCents(p.shareCents) }) : t('Fora da divisão · pagou {paid}', { paid: formatCents(p.paidCents) })}
                  </span>
                </span>
                <span className={`evshop__balance${p.balanceCents < 0 ? ' evshop__balance--owe' : ''}`}>{p.balanceCents === 0 ? '—' : `${p.balanceCents > 0 ? '+' : '−'}${formatCents(Math.abs(p.balanceCents))}`}</span>
                {view.isAdmin ? (
                  <label className="evshop__in">
                    <input type="checkbox" checked={p.included} disabled={busy} onChange={(e) => void run(() => api.setSplitMember(eventId, p.user.userId, e.target.checked))} />
                    <span className="visually-hidden">{t('Entra na divisão')}</span>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
          {view.isAdmin ? <p className="muted evshop__hint">{t('Desmarque quem não entra na divisão. O total se divide por igual entre os marcados.')}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function ExpenseRow({ eventId, view, expense, busy, run, onProblem }: { eventId: string; view: EventShoppingView; expense: EventExpense; busy: boolean; run: Run; onProblem: (p: string | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);

  async function open() {
    if (!expense.fileName) return;
    setOpening(true);
    onProblem(undefined);
    try {
      await openDocument(await api.expenseFile(eventId, expense.id), expense.fileName);
    } catch (failure) {
      onProblem(toApiError(failure).message);
    } finally {
      setOpening(false);
    }
  }

  if (editing) return <li className="evshop__expense"><ExpenseEditor eventId={eventId} view={view} expense={expense} busy={busy} run={run} onDone={() => setEditing(false)} /></li>;

  const title = expense.note ?? expense.fileName ?? t('Gasto');
  return (
    <li className="evshop__expense">
      <span className="evshop__itemtext">
        {expense.fileName ? (
          <button type="button" className="evshop__file" onClick={() => void open()} aria-busy={opening || undefined}>
            <DocIcon /> {title}
          </button>
        ) : (
          <span className="evshop__itemtitle">{title}</span>
        )}
        <span className="muted evshop__itemmeta">
          {expense.amountCents !== null ? formatCents(expense.amountCents) : t('Sem valor')}
          {' · '}
          {expense.payer ? t('pago por {name}', { name: expense.payer.displayName }) : t('sem quem pagou')}
          {expense.uploader && expense.fileName ? ` · ${t('anexado por {name}', { name: expense.uploader.displayName })}` : ''}
        </span>
      </span>
      {view.isAdmin ? (
        <button type="button" className="evshop__icon" onClick={() => setEditing(true)} aria-label={t('Informar valor e quem pagou')} disabled={busy}>
          <EditIcon />
        </button>
      ) : null}
      {expense.canDelete ? (
        <button type="button" className="evshop__icon" onClick={() => void run(() => api.deleteExpense(eventId, expense.id))} aria-label={t('Apagar gasto')} disabled={busy}>
          <TrashIcon />
        </button>
      ) : null}
    </li>
  );
}

/** Quem administra: valor, quem pagou e descrição de um gasto (novo, sem anexo, ou um anexo que já existe). */
function ExpenseEditor({ eventId, view, expense, busy, run, onDone }: { eventId: string; view: EventShoppingView; expense?: EventExpense; busy: boolean; run: Run; onDone: () => void }) {
  const [amount, setAmount] = useState(centsToInput(expense?.amountCents ?? null));
  const [payerId, setPayerId] = useState(expense?.payer?.userId ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [error, setError] = useState<string | undefined>();
  const people = view.split?.people ?? [];
  const options = people.filter((p) => p.included || p.user.userId === payerId || view.expenses.some((e) => e.payer?.userId === p.user.userId));

  async function save(event: FormEvent) {
    event.preventDefault();
    const cents = amount.trim() === '' ? null : parseMoney(amount);
    if (cents === undefined) {
      setError(t('Valor inválido. Use, por exemplo, 45,90.'));
      return;
    }
    if (!expense && (cents === null || payerId === '')) {
      setError(t('Informe o valor e quem pagou.'));
      return;
    }
    setError(undefined);
    const input = { amountCents: cents, payerId: payerId === '' ? null : payerId, note: note.trim() || null };
    const ok = expense ? await run(() => api.updateExpense(eventId, expense.id, input)) : await run(() => api.addExpense(eventId, { amountCents: cents!, payerId, note: input.note }));
    if (ok) onDone();
  }

  return (
    <form className="evshop__editor" onSubmit={(e) => void save(e)}>
      <label className="evshop__label">
        {t('Valor (R$)')}
        <input className="evshop__input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus />
      </label>
      <label className="evshop__label">
        {t('Quem pagou')}
        <select className="evshop__input" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
          <option value="">{t('Escolha')}</option>
          {options.map((p) => (
            <option key={p.user.userId} value={p.user.userId}>{p.user.displayName}</option>
          ))}
        </select>
      </label>
      <label className="evshop__label">
        {t('Descrição')}
        <input className="evshop__input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder={t('Ex.: mercado, gelo, bebidas')} />
      </label>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="evshop__editoractions">
        <Button small type="submit" loading={busy}>{t('Salvar')}</Button>
        <Button small variant="quiet" onClick={onDone}>{t('Cancelar')}</Button>
      </div>
    </form>
  );
}
