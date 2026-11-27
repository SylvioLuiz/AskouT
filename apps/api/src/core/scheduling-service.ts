import { conflict, forbidden, notFound, validationError } from './errors.ts';
import { EVENT_GROUP_CAPACITY, joinEventGroups } from './event-group-members.ts';
import type { CoreDeps } from './ports.ts';
import { computeDateStats, dateRange, daysBetween, decideConfirmation, hasEnoughData, isDay, isTimeZone, rankDates, tallyConfirmations, todayIn, VOTE_STATUSES, zonedTimeToUtc } from './scheduling.ts';
import type { ConfirmationPolicy, ConfirmationStatus, ConfirmationTally, DateStats, Thresholds, VoteStatus } from './scheduling.ts';
import type { MeetupRecord, MessageRecord, PollProposalRecord, PollRecord, PollStatus, PollVoteRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

/** Nome do grupo da votação de um evento (o mesmo limite dos grupos). */
const EVENT_GROUP_NAME_MAX = 60;

export const POLL_TITLE_MAX = 120;
/** Dias que cabem num intervalo (inclusive). */
export const POLL_MAX_DAYS = 60;
export const POLL_DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
export const POLL_DEFAULT_START = '19:00';
/** Horários que cabem numa votação com horário. */
export const POLL_MAX_TIMES = 12;
export type PollMode = PollRecord['schedulingMode'];
const MODES: readonly PollMode[] = ['BEST_DATE', 'BEST_TIME', 'BEST_DATE_TIME'];

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const POLICIES: readonly ConfirmationPolicy[] = ['UNANIMITY', 'MAJORITY', 'MANUAL'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface PollInput {
  title?: unknown;
  rangeStart?: unknown;
  rangeEnd?: unknown;
  durationMinutes?: unknown;
  preferredTimeStart?: unknown;
  timezone?: unknown;
  votingDeadline?: unknown;
  confirmationPolicy?: unknown;
  thresholds?: unknown;
  /** BEST_DATE (padrão): vota os dias. BEST_TIME: o dia já está definido (início = fim) e vota os horários. BEST_DATE_TIME: vota os dias e os horários. */
  mode?: unknown;
  /** Com horário (BEST_TIME e BEST_DATE_TIME): de 2 a 12 horários (HH:MM). */
  candidateTimes?: unknown;
  /** Evento seu ainda sem data: a votação decide a data dele (ao fechar, o evento ganha o dia escolhido). */
  eventPostId?: unknown;
}

export interface PollProposalView {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  status: PollProposalRecord['status'];
  compatibility: number | null;
  coverage: number;
  yes: number;
  maybe: number;
  no: number;
  unanswered: number;
  createdAt: string;
}

export interface PollView {
  id: string;
  conversationId: string;
  conversationName: string | null;
  isGroup: boolean;
  /** Você está na conversa da votação. Em votação de evento, quem ainda não aceitou ("Eu vou") vota sem estar no grupo. */
  inConversation: boolean;
  /** Evento sem data cuja data esta votação escolhe. */
  eventPostId: string | null;
  title: string;
  /** O que se vota: os dias (BEST_DATE), os horários de um dia já definido (BEST_TIME) ou os dois (BEST_DATE_TIME). */
  mode: PollMode;
  /** Horários em votação (vazio no BEST_DATE). */
  candidateTimes: string[];
  status: PollStatus;
  organizer: PublicProfile;
  isOrganizer: boolean;
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  preferredTimeStart: string | null;
  timezone: string;
  votingDeadline: string | null;
  /** Dá para votar agora: votando e dentro do prazo. */
  votingOpen: boolean;
  /** Votos encerrados: pelo organizador ou porque o prazo acabou. */
  votingClosed: boolean;
  /** Quem organiza pode encerrar agora: todos já concluíram. */
  canClose: boolean;
  confirmationPolicy: ConfirmationPolicy;
  thresholds: Thresholds;
  participants: { profile: PublicProfile; finished: boolean; confirmation: ConfirmationStatus | null }[];
  /** Todos os dias do intervalo, com os números do mapa de calor (vazio no BEST_TIME). */
  days: DateStats[];
  /** Os horários em votação, com os mesmos números (`date` é o horário HH:MM; vazio no BEST_DATE). */
  times: DateStats[];
  /** Seus votos por dia (AAAA-MM-DD) e por horário (HH:MM). Sem voto = sem resposta. */
  myVotes: Record<string, VoteStatus>;
  iFinished: boolean;
  /** Melhores datas, da melhor para a pior. */
  ranking: DateStats[];
  /** Melhores horários, do melhor para o pior. */
  timeRanking: DateStats[];
  enoughData: boolean;
  /** Proposta em confirmação. */
  proposal: (PollProposalView & { tally: ConfirmationTally; myConfirmation: ConfirmationStatus | null }) | null;
  /** Histórico de propostas (a mais recente primeiro). */
  history: PollProposalView[];
  final: { date: string; startsAt: string; endsAt: string; meetupId: string | null } | null;
  createdAt: string;
}

export interface PollSummary {
  id: string;
  conversationId: string;
  title: string;
  mode: PollMode;
  status: PollStatus;
  rangeStart: string;
  rangeEnd: string;
  finalDate: string | null;
  /** Votação aberta em que você ainda não marcou "concluí". */
  needsMyVote: boolean;
  /** Proposta esperando a sua confirmação. */
  needsMyConfirmation: boolean;
  participantCount: number;
  /** Quantas pessoas já marcaram ao menos um dia. */
  votedCount: number;
  /** Fim do encontro definido (some da conversa depois dele). */
  finalEndsAt: string | null;
  /** Quantas pessoas marcaram "concluí minha votação". */
  finishedCount: number;
  /** Melhor data até agora (nula sem votos suficientes). */
  best: { date: string; time: string | null; compatibility: number | null; coverage: number } | null;
  /** Data proposta, enquanto espera confirmação. */
  proposedDate: string | null;
  votingDeadline: string | null;
  /** Encontro (agenda) gerado ao definir a data. */
  meetupId: string | null;
  /** Evento criado a partir desta votação; quando existe, substitui a votação nas listas do grupo. */
  /** Evento ligado à votação; sem data enquanto ela não fecha (quando a votação decide a data do evento). */
  event: { id: string; title: string; startsAt: string | null; endsAt: string | null } | null;
}

function parseThresholds(raw: unknown): Thresholds {
  const base: Thresholds = { green: 80, orange: 50, minCoverage: 50 };
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw validationError('Limites inválidos', { thresholds: 'Informe verde, laranja e cobertura mínima' });
  const o = raw as Record<string, unknown>;
  const pick = (key: 'green' | 'orange' | 'minCoverage'): number => {
    const v = o[key] === undefined ? base[key] : o[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) throw validationError('Limites inválidos', { thresholds: 'Use números inteiros de 0 a 100' });
    return v;
  };
  const th = { green: pick('green'), orange: pick('orange'), minCoverage: pick('minCoverage') };
  if (th.green < 1 || th.green > 100 || th.orange < 0 || th.orange >= th.green || th.minCoverage < 0 || th.minCoverage > 100) {
    throw validationError('Limites inválidos', { thresholds: 'O verde vem acima do laranja; valores de 0 a 100' });
  }
  return th;
}

function present(p: PollProposalRecord): PollProposalView {
  return {
    id: p.id,
    date: p.candidateDate,
    startsAt: p.candidateStartAt.toISOString(),
    endsAt: p.candidateEndAt.toISOString(),
    status: p.status,
    compatibility: p.compatibilityScore,
    coverage: p.coverageScore,
    yes: p.availableCount,
    maybe: p.maybeCount,
    no: p.unavailableCount,
    unanswered: p.unansweredCount,
    createdAt: p.createdAt.toISOString(),
  };
}

const dayFmt = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Vota os dias? (Não na votação só de horário, em que o dia já está definido.) */
const votesDays = (poll: PollRecord): boolean => poll.schedulingMode !== 'BEST_TIME';
/** Vota os horários? */
const votesTimes = (poll: PollRecord): boolean => poll.schedulingMode !== 'BEST_DATE';

const dayKeys = (poll: PollRecord): string[] => (votesDays(poll) ? dateRange(poll.rangeStart, poll.rangeEnd) : []);
const timeKeys = (poll: PollRecord): string[] => (votesTimes(poll) ? [...(poll.candidateTimes ?? [])] : []);

/** HH:MM de um instante no fuso. */
function timeInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** "24/11" ou, com horário votado, "24/11 às 20:00". */
function whenFmt(poll: PollRecord, day: string, startsAt: Date): string {
  return votesTimes(poll) ? `${dayFmt(day)} às ${timeInZone(startsAt, poll.timezone)}` : dayFmt(day);
}

/** "Data", "Horário" ou "Data e horário": o que a votação decide. */
function decidedWord(poll: PollRecord): string {
  return poll.schedulingMode === 'BEST_TIME' ? 'Horário' : poll.schedulingMode === 'BEST_DATE_TIME' ? 'Data e horário' : 'Data';
}

/** Horários: HH:MM, sem repetir, de 2 a POLL_MAX_TIMES, em ordem. */
function parseTimes(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw validationError('Escolha os horários', { candidateTimes: `De 2 a ${POLL_MAX_TIMES} horários` });
  const times = [...new Set(raw)];
  if (times.some((t) => typeof t !== 'string' || !TIME_RE.test(t))) throw validationError('Horário inválido', { candidateTimes: 'Use HH:MM' });
  if (times.length < 2 || times.length > POLL_MAX_TIMES) throw validationError('Escolha os horários', { candidateTimes: `De 2 a ${POLL_MAX_TIMES} horários` });
  return (times as string[]).sort();
}

const VOTE_RANK: Record<VoteStatus, number> = { NO: 0, MAYBE: 1, YES: 2 };

/**
 * Números de uma combinação dia + horário: cada pessoa conta com a pior resposta entre o dia e o horário
 * (o que a votação não vota fica de fora); quem não respondeu a um dos dois fica "sem resposta".
 */
function comboStats(poll: PollRecord, votes: readonly PollVoteRecord[], ids: readonly string[], th: Thresholds, day: string, time: string): DateStats {
  const keys = [votesDays(poll) ? day : null, votesTimes(poll) ? time : null].filter((k): k is string => k !== null);
  const byUser = new Map<string, Map<string, VoteStatus>>();
  for (const v of votes) {
    if (!keys.includes(v.date)) continue;
    let m = byUser.get(v.userId);
    if (!m) byUser.set(v.userId, (m = new Map()));
    m.set(v.date, v.status);
  }
  const combined: { userId: string; date: string; status: VoteStatus }[] = [];
  for (const [userId, m] of byUser) {
    const answers = keys.map((k) => m.get(k));
    if (answers.some((a) => a === undefined)) continue;
    const worst = (answers as VoteStatus[]).reduce((a, b) => (VOTE_RANK[b] < VOTE_RANK[a] ? b : a));
    combined.push({ userId, date: day, status: worst });
  }
  return computeDateStats([day], combined, ids, th)[0]!;
}

/** "Encontrar a melhor data": votação de disponibilidade, ranking, confirmação e fechamento da data. */
export class SchedulingService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  // ---------- Criar ----------

  /**
   * Abre a votação numa conversa sua (grupo ou 1 a 1). Entram todos os membros da conversa, menos quem tem bloqueio com você.
   * Sem conversa e com `eventPostId` (evento seu sem data): a votação abre no grupo do evento e vota todo convidado. No grupo
   * só fica quem já aceitou ("Eu vou"); quem ainda não respondeu vota pela votação (aviso e página do evento), fora do grupo.
   */
  async create(actorId: string, conversationIdRaw: unknown, input: PollInput): Promise<PollView> {
    const { conversations, blocks, follows, scheduling, clock, ids } = this.deps;
    const byEvent = (conversationIdRaw === undefined || conversationIdRaw === null || conversationIdRaw === '') && typeof input.eventPostId === 'string' && input.eventPostId !== '';
    const fromEvent = byEvent ? await this.eventGroup(actorId, input.eventPostId) : undefined;
    const conversationId = fromEvent ? fromEvent.conversationId : conversationIdRaw;
    const conversation = typeof conversationId === 'string' && conversationId !== '' && conversationId.length <= 64 ? await conversations.findById(conversationId) : undefined;
    const members = conversation ? await conversations.participantIds(conversation.id) : undefined;
    if (!conversation || !members || !members.includes(actorId)) throw notFound('Conversa não encontrada');

    const related = new Set(await blocks.listRelatedIds(actorId));
    // Votação de evento: votam os convidados, estejam ou não no grupo (quem não aceitou ainda não está).
    let others = [...new Set([...members, ...(fromEvent?.voters ?? [])])].filter((id) => id !== actorId && !related.has(id));
    if (conversation.type === 'DIRECT') {
      const friends = await follows.listFriendIds(actorId);
      others = others.filter((id) => friends.includes(id));
    }
    if (others.length === 0) throw validationError('Convide ao menos mais uma pessoa', { conversationId: 'Não há com quem votar nesta conversa' });

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title === '' || CONTROL_RE.test(title) || Array.from(title).length > POLL_TITLE_MAX) throw validationError('Nome inválido', { title: `Use de 1 a ${POLL_TITLE_MAX} caracteres` });

    const timezone = input.timezone === undefined || input.timezone === null || input.timezone === '' ? POLL_DEFAULT_TIME_ZONE : input.timezone;
    if (!isTimeZone(timezone)) throw validationError('Fuso horário inválido', { timezone: 'Fuso desconhecido' });
    const now = clock.now();
    const today = todayIn(timezone, now);

    if (!isDay(input.rangeStart)) throw validationError('Data inicial inválida', { rangeStart: 'Use o formato AAAA-MM-DD' });
    if (!isDay(input.rangeEnd)) throw validationError('Data final inválida', { rangeEnd: 'Use o formato AAAA-MM-DD' });
    if (input.rangeStart < today) throw validationError('A data inicial já passou', { rangeStart: 'Escolha hoje ou um dia futuro' });
    if (input.rangeEnd < input.rangeStart) throw validationError('Período inválido', { rangeEnd: 'A data final vem depois da inicial' });
    if (daysBetween(input.rangeStart, input.rangeEnd) + 1 > POLL_MAX_DAYS) throw validationError('Período longo demais', { rangeEnd: `No máximo ${POLL_MAX_DAYS} dias` });

    const mode = input.mode === undefined || input.mode === null || input.mode === '' ? 'BEST_DATE' : input.mode;
    if (typeof mode !== 'string' || !MODES.includes(mode as PollMode)) throw validationError('Tipo de votação inválido', { mode: 'Use BEST_DATE, BEST_TIME ou BEST_DATE_TIME' });
    let candidateTimes: string[] = [];
    if (mode !== 'BEST_DATE') candidateTimes = parseTimes(input.candidateTimes);
    if (mode === 'BEST_TIME') {
      if (input.rangeEnd !== input.rangeStart) throw validationError('Escolha um dia só', { rangeEnd: 'Votando só o horário, o dia já está definido' });
      const day = input.rangeStart;
      if (candidateTimes.some((t) => zonedTimeToUtc(day, t, timezone) <= now)) throw validationError('Esse horário já passou', { candidateTimes: 'Escolha horários futuros' });
    }

    const duration = input.durationMinutes === undefined || input.durationMinutes === null ? 180 : input.durationMinutes;
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 15 || duration > 1440) throw validationError('Duração inválida', { durationMinutes: 'De 15 minutos a 24 horas' });

    let preferred: string | null = null;
    if (mode === 'BEST_DATE' && input.preferredTimeStart !== undefined && input.preferredTimeStart !== null && input.preferredTimeStart !== '') {
      if (typeof input.preferredTimeStart !== 'string' || !TIME_RE.test(input.preferredTimeStart)) throw validationError('Horário inválido', { preferredTimeStart: 'Use HH:MM' });
      preferred = input.preferredTimeStart;
    }

    let deadline: Date | null = null;
    if (input.votingDeadline !== undefined && input.votingDeadline !== null && input.votingDeadline !== '') {
      deadline = typeof input.votingDeadline === 'string' ? new Date(input.votingDeadline) : null;
      if (!deadline || Number.isNaN(deadline.getTime())) throw validationError('Prazo inválido', { votingDeadline: 'Use uma data e hora' });
      if (deadline <= now) throw validationError('O prazo já passou', { votingDeadline: 'Escolha um prazo no futuro' });
    }

    const policy = input.confirmationPolicy === undefined || input.confirmationPolicy === null ? 'MAJORITY' : input.confirmationPolicy;
    if (typeof policy !== 'string' || !POLICIES.includes(policy as ConfirmationPolicy)) throw validationError('Regra inválida', { confirmationPolicy: 'Use unanimidade, maioria ou decisão manual' });
    const th = parseThresholds(input.thresholds);
    const eventPostId = input.eventPostId === undefined || input.eventPostId === null || input.eventPostId === '' ? null : await this.undatedEvent(actorId, input.eventPostId);

    const poll: PollRecord = {
      id: ids.next(),
      conversationId: conversation.id,
      organizerId: actorId,
      title,
      schedulingMode: mode as PollMode,
      candidateTimes,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      durationMinutes: duration,
      preferredTimeStart: preferred,
      timezone,
      votingDeadline: deadline,
      confirmationPolicy: policy as ConfirmationPolicy,
      greenMin: th.green,
      orangeMin: th.orange,
      minCoverage: th.minCoverage,
      status: 'VOTING',
      finalProposalId: null,
      meetupId: null,
      createdAt: now,
    };
    await scheduling.create(poll, [actorId, ...others], now);
    if (eventPostId) {
      await scheduling.updatePoll(poll.id, { eventPostId });
      poll.eventPostId = eventPostId;
    }

    const name = await this.nameOf(actorId);
    if (mode === 'BEST_TIME') {
      await this.postSystem(conversation.id, actorId, `${name} abriu uma votação de horário: ${title} (${dayFmt(poll.rangeStart)})`, now);
      await this.notifyAll(actorId, others, poll, `${name} quer achar o melhor horário`, `${title} (${dayFmt(poll.rangeStart)}): marque os horários em que você pode.`);
    } else if (mode === 'BEST_DATE_TIME') {
      await this.postSystem(conversation.id, actorId, `${name} abriu uma votação de data e horário: ${title}`, now);
      await this.notifyAll(actorId, others, poll, `${name} quer achar a melhor data e horário`, `${title}: marque os dias e os horários em que você pode.`);
    } else {
      await this.postSystem(conversation.id, actorId, `${name} abriu uma votação de datas: ${title}`, now);
      await this.notifyAll(actorId, others, poll, `${name} quer achar a melhor data`, `${title}: marque os dias em que você pode.`);
    }
    return this.view(actorId, poll);
  }

  // ---------- Editar ----------

  /**
   * Quem organiza muda o nome, as datas (período) e a regra de escolha enquanto a votação está aberta.
   * Os votos de dias que saem do período ficam guardados (voltam se o dia voltar), mas não contam nem aparecem.
   * Se entram dias novos, quem já tinha concluído volta a poder votar neles.
   */
  async update(actorId: string, pollId: unknown, input: { title?: unknown; rangeStart?: unknown; rangeEnd?: unknown; confirmationPolicy?: unknown }): Promise<PollView> {
    const { scheduling, clock } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação a edita');
    this.requireVotingOpen(poll);
    const now = clock.now();
    const today = todayIn(poll.timezone, now);

    const patch: { title?: string; rangeStart?: string; rangeEnd?: string; confirmationPolicy?: ConfirmationPolicy } = {};
    const changes: string[] = [];

    if (input.title !== undefined) {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (title === '' || CONTROL_RE.test(title) || Array.from(title).length > POLL_TITLE_MAX) throw validationError('Nome inválido', { title: `Use de 1 a ${POLL_TITLE_MAX} caracteres` });
      if (title !== poll.title) {
        patch.title = title;
        changes.push('o nome');
      }
    }

    if (input.rangeStart !== undefined || input.rangeEnd !== undefined) {
      const rangeStart = input.rangeStart === undefined ? poll.rangeStart : input.rangeStart;
      const rangeEnd = input.rangeEnd === undefined ? poll.rangeEnd : input.rangeEnd;
      if (!isDay(rangeStart)) throw validationError('Data inicial inválida', { rangeStart: 'Use o formato AAAA-MM-DD' });
      if (!isDay(rangeEnd)) throw validationError('Data final inválida', { rangeEnd: 'Use o formato AAAA-MM-DD' });
      if (rangeStart !== poll.rangeStart && rangeStart < today) throw validationError('A data inicial já passou', { rangeStart: 'Escolha hoje ou um dia futuro' });
      if (rangeEnd < today) throw validationError('A data final já passou', { rangeEnd: 'Escolha hoje ou um dia futuro' });
      if (rangeEnd < rangeStart) throw validationError('Período inválido', { rangeEnd: 'A data final vem depois da inicial' });
      if (daysBetween(rangeStart, rangeEnd) + 1 > POLL_MAX_DAYS) throw validationError('Período longo demais', { rangeEnd: `No máximo ${POLL_MAX_DAYS} dias` });
      if (!votesDays(poll)) {
        if (rangeEnd !== rangeStart) throw validationError('Escolha um dia só', { rangeEnd: 'Votando só o horário, o dia já está definido' });
        if (rangeStart !== poll.rangeStart && (poll.candidateTimes ?? []).some((t) => zonedTimeToUtc(rangeStart, t, poll.timezone) <= now)) throw validationError('Esse horário já passou', { rangeStart: 'Escolha um dia em que os horários ainda não passaram' });
      }
      if (rangeStart !== poll.rangeStart || rangeEnd !== poll.rangeEnd) {
        patch.rangeStart = rangeStart;
        patch.rangeEnd = rangeEnd;
        changes.push(votesDays(poll) ? 'as datas' : 'o dia');
      }
    }

    if (input.confirmationPolicy !== undefined) {
      const policy = input.confirmationPolicy;
      if (typeof policy !== 'string' || !POLICIES.includes(policy as ConfirmationPolicy)) throw validationError('Regra inválida', { confirmationPolicy: 'Use unanimidade, maioria ou decisão manual' });
      if (policy !== poll.confirmationPolicy) {
        patch.confirmationPolicy = policy as ConfirmationPolicy;
        changes.push('quem escolhe a data');
      }
    }

    if (changes.length === 0) return this.view(actorId, poll);
    await scheduling.updatePoll(poll.id, patch);
    const updated: PollRecord = { ...poll, ...patch };

    // Dias novos no período: quem já tinha concluído precisa poder votar neles.
    const oldDays = new Set(dateRange(poll.rangeStart, poll.rangeEnd));
    // Votando só o horário, mudar o dia muda tudo: todos revisam os votos.
    const addedDays = patch.rangeStart !== undefined && (!votesDays(poll) || dateRange(updated.rangeStart, updated.rangeEnd).some((d) => !oldDays.has(d)));
    const participants = await scheduling.listParticipants(poll.id);
    if (addedDays) {
      for (const p of participants) if (p.finishedAt !== null) await scheduling.setFinished(poll.id, p.userId, null);
    }

    const name = await this.nameOf(actorId);
    const what = changes.length === 1 ? changes[0]! : `${changes.slice(0, -1).join(', ')} e ${changes[changes.length - 1]!}`;
    await this.postSystem(poll.conversationId, actorId, `${name} mudou ${what} da votação "${updated.title}"${addedDays ? (votesDays(poll) ? '. Há dias novos para votar.' : `. Agora é em ${dayFmt(updated.rangeStart)}: confira seus horários.`) : ''}`, now);
    if (patch.rangeStart !== undefined || patch.title !== undefined) {
      await this.notifyAll(actorId, participants.map((p) => p.userId).filter((id) => id !== actorId), updated, 'Votação atualizada', `${name} mudou ${what} de "${updated.title}". Confira seus votos.`);
    }
    return this.view(actorId, updated);
  }

  // ---------- Ler ----------

  async get(actorId: string, pollId: unknown): Promise<PollView> {
    const poll = await this.accessible(actorId, pollId);
    return this.view(actorId, poll);
  }

  /** Votações de uma conversa sua. */
  async listForConversation(actorId: string, conversationId: unknown): Promise<{ items: PollSummary[] }> {
    const { conversations, scheduling } = this.deps;
    const members = typeof conversationId === 'string' && conversationId !== '' && conversationId.length <= 64 ? await conversations.participantIds(conversationId) : undefined;
    if (!members || !members.includes(actorId)) throw notFound('Conversa não encontrada');
    const polls = await scheduling.listForConversation(conversationId as string);
    return { items: await this.summaries(actorId, polls.filter((p) => p.status !== 'CANCELLED')) };
  }

  /** Votações abertas em que você participa (Home). */
  async listMine(actorId: string): Promise<{ items: PollSummary[] }> {
    return { items: await this.summaries(actorId, await this.deps.scheduling.listOpenForUser(actorId, 10)) };
  }

  // ---------- Votar ----------

  /** Marca vários dias de uma vez com o mesmo estado; `CLEAR` volta os dias para "sem resposta". */
  async vote(actorId: string, pollId: unknown, input: { status?: unknown; dates?: unknown }): Promise<PollView> {
    const { scheduling, clock } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    this.requireVotingOpen(poll);
    const status = input.status === 'CLEAR' ? null : input.status;
    if (status !== null && !VOTE_STATUSES.includes(status as VoteStatus)) throw validationError('Resposta inválida', { status: 'Use YES, MAYBE, NO ou CLEAR' });
    const max = POLL_MAX_DAYS + POLL_MAX_TIMES;
    if (!Array.isArray(input.dates) || input.dates.length === 0 || input.dates.length > max) throw validationError('Escolha os dias ou horários', { dates: `Envie de 1 a ${max} opções` });
    const today = todayIn(poll.timezone, clock.now());
    const dates = [...new Set(input.dates)];
    const times = new Set(timeKeys(poll));
    for (const d of dates) {
      if (typeof d === 'string' && times.has(d)) continue;
      if (typeof d === 'string' && TIME_RE.test(d)) throw validationError('Horário fora da votação', { dates: votesTimes(poll) ? `Só ${[...times].join(', ')}` : 'Esta votação não vota horário' });
      if (!votesDays(poll)) throw validationError('Escolha os horários', { dates: `Só ${[...times].join(', ')}` });
      if (!isDay(d)) throw validationError('Dia inválido', { dates: 'Use o formato AAAA-MM-DD' });
      if (d < poll.rangeStart || d > poll.rangeEnd) throw validationError('Dia fora do período', { dates: `Só de ${dayFmt(poll.rangeStart)} a ${dayFmt(poll.rangeEnd)}` });
      if (d < today) throw validationError('Esse dia já passou', { dates: 'Escolha dias de hoje em diante' });
    }
    await scheduling.setVotes(poll.id, actorId, dates as string[], status as VoteStatus | null, clock.now());
    return this.view(actorId, poll);
  }

  /** "Concluí minha votação" (ou reabrir a sua). Não muda nenhum voto. */
  async finish(actorId: string, pollId: unknown, finished: unknown): Promise<PollView> {
    const poll = await this.accessible(actorId, pollId);
    this.requireVotingOpen(poll);
    await this.deps.scheduling.setFinished(poll.id, actorId, finished === false ? null : this.deps.clock.now());
    return this.view(actorId, poll);
  }

  // ---------- Propor e confirmar ----------

  /** Só quem organiza: manda uma data candidata para confirmação. */
  async propose(actorId: string, pollId: unknown, date: unknown, time?: unknown): Promise<PollView> {
    const { scheduling, clock, ids } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação escolhe a data');
    if (poll.status !== 'VOTING') throw conflict(poll.status === 'CONFIRMING' ? 'Já existe uma data em confirmação' : 'Esta votação já terminou');
    const now = clock.now();
    const participants = await scheduling.listParticipants(poll.id);
    const { day, startsAt, stats } = this.pick(poll, await scheduling.listVotes(poll.id), participants.map((p) => p.userId), date, time, false);
    const endsAt = new Date(startsAt.getTime() + poll.durationMinutes * 60_000);
    const proposal: PollProposalRecord = {
      id: ids.next(),
      pollId: poll.id,
      candidateDate: day,
      candidateStartAt: startsAt,
      candidateEndAt: endsAt,
      compatibilityScore: stats.compatibility,
      coverageScore: stats.coverage,
      availableCount: stats.yes,
      maybeCount: stats.maybe,
      unavailableCount: stats.no,
      unansweredCount: stats.unanswered,
      status: 'OPEN',
      createdAt: now,
    };
    await scheduling.createProposal(proposal);
    await scheduling.updatePoll(poll.id, { status: 'CONFIRMING' });
    await scheduling.setConfirmation(proposal.id, poll.id, actorId, 'CONFIRMED', now);

    const name = await this.nameOf(actorId);
    const when = whenFmt(poll, day, startsAt);
    await this.postSystem(poll.conversationId, actorId, `${name} propôs ${when} para "${poll.title}". Confirme sua presença.`, now);
    await this.notifyAll(actorId, participants.map((p) => p.userId).filter((id) => id !== actorId), poll, `Confirme: ${when}`, `${name} escolheu ${when} para "${poll.title}".`);
    return this.view(actorId, { ...poll, status: 'CONFIRMING' });
  }

  /** Quem organiza encerra os votos quando todos já concluíram. Depois disso ninguém muda voto e a data pode ser escolhida. */
  async closeVoting(actorId: string, pollId: unknown): Promise<PollView> {
    const { scheduling, clock } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação a encerra');
    if (poll.status !== 'VOTING') throw conflict('Esta votação já passou da fase de votos');
    if (this.isClosed(poll)) throw conflict('Os votos já foram encerrados');
    const participants = await scheduling.listParticipants(poll.id);
    if (!participants.every((p) => p.finishedAt !== null)) throw conflict('Ainda faltam pessoas concluírem a votação');
    const now = clock.now();
    await scheduling.updatePoll(poll.id, { votingClosedAt: now });
    await this.postSystem(poll.conversationId, actorId, `Votação "${poll.title}" encerrada: todos votaram. Falta escolher a data.`, now);
    return this.view(actorId, { ...poll, votingClosedAt: now });
  }

  /**
   * Avisa que o prazo da votação acabou (uma vez só por votação): mensagem no chat e aviso para cada participante.
   * Quem organiza recebe o convite a escolher a data. Roda num job periódico; devolve quantas votações avisou.
   */
  async notifyDeadlines(): Promise<number> {
    const { scheduling, clock } = this.deps;
    const now = clock.now();
    const due = await scheduling.listDeadlinePassed(now, 50);
    let done = 0;
    for (const poll of due) {
      // Marca antes de avisar: se duas instâncias rodarem juntas, o pior caso é não avisar, nunca avisar em dobro.
      await scheduling.updatePoll(poll.id, { deadlineNotifiedAt: now });
      const participants = await scheduling.listParticipants(poll.id);
      const ids = participants.map((p) => p.userId);
      const finished = participants.filter((p) => p.finishedAt !== null).length;
      await this.postSystem(poll.conversationId, poll.organizerId, `O prazo da votação "${poll.title}" acabou. ${finished} de ${ids.length} concluíram. Falta escolher a data.`, now);
      await this.notifyAll(poll.organizerId, ids.filter((id) => id !== poll.organizerId), poll, 'Votação encerrada', `O prazo de "${poll.title}" acabou. Quem organiza escolhe a data agora.`);
      await this.deps.notifier.notify({ userId: poll.organizerId, type: 'MEETUP_INVITE', title: 'Sua votação encerrou', body: `O prazo de "${poll.title}" acabou. Escolha a data com base nos votos.`, url: `/planejar/${poll.id}`, dedupeKey: `poll:${poll.id}:deadline-organizer` });
      done += 1;
    }
    return done;
  }

  /**
   * Atalho de quem organiza, quando todos já votaram (ou os votos foram encerrados): confirma a melhor data de uma vez.
   * Cria o encontro já com quem votou "posso" e "talvez" naquele dia, todos confirmados (mais quem organiza), sem etapa de confirmação.
   * Quem votou "não posso" ou não respondeu fica de fora. Sem `date`, usa a primeira do ranking.
   */
  async confirmBest(actorId: string, pollId: unknown, date?: unknown, time?: unknown): Promise<PollView> {
    const { scheduling, meetups, conversations, blocks, clock, ids } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação confirma a data');
    if (poll.status !== 'VOTING') throw conflict(poll.status === 'CONFIRMING' ? 'Já existe uma data em confirmação' : 'Esta votação já terminou');
    const participants = await scheduling.listParticipants(poll.id);
    if (!this.isClosed(poll) && !participants.every((p) => p.finishedAt !== null)) throw conflict('Ainda faltam pessoas concluírem a votação');

    const votes = await scheduling.listVotes(poll.id);
    const { day: chosen, time: chosenTime, startsAt, stats } = this.pick(poll, votes, participants.map((p) => p.userId), date, time, true);

    const now = clock.now();
    const endsAt = new Date(startsAt.getTime() + poll.durationMinutes * 60_000);

    const hidden = new Set(await blocks.listRelatedIds(actorId));
    // Pode quem disse "posso" ou "talvez" no dia e no horário escolhidos (o que a votação vota).
    const ok = (key: string) => new Set(votes.filter((v) => v.date === key && (v.status === 'YES' || v.status === 'MAYBE')).map((v) => v.userId));
    const okDay = votesDays(poll) ? ok(chosen) : undefined;
    const okTime = votesTimes(poll) ? ok(chosenTime) : undefined;
    const can = new Set(participants.map((p) => p.userId).filter((userId) => (okDay?.has(userId) ?? true) && (okTime?.has(userId) ?? true)));
    const going = participants.map((p) => p.userId).filter((userId) => userId === actorId || (can.has(userId) && !hidden.has(userId)));

    const proposal: PollProposalRecord = {
      id: ids.next(),
      pollId: poll.id,
      candidateDate: chosen,
      candidateStartAt: startsAt,
      candidateEndAt: endsAt,
      compatibilityScore: stats.compatibility,
      coverageScore: stats.coverage,
      availableCount: stats.yes,
      maybeCount: stats.maybe,
      unavailableCount: stats.no,
      unansweredCount: stats.unanswered,
      status: 'CONFIRMED',
      createdAt: now,
    };
    const meetup: MeetupRecord = {
      id: ids.next(),
      organizerId: poll.organizerId,
      conversationId: poll.conversationId,
      eventId: null,
      eventPostId: poll.eventPostId ?? null,
      title: poll.title,
      startsAt,
      endsAt,
      status: 'ACTIVE',
      createdAt: now,
      participants: going.map((userId) => ({ userId, status: 'CONFIRMED' as const, respondedAt: now })),
    };
    await scheduling.createProposal(proposal);
    for (const userId of going) await scheduling.setConfirmation(proposal.id, poll.id, userId, 'CONFIRMED', now);
    await meetups.create(meetup);
    await this.fillEventDate(poll, startsAt, endsAt, going);
    await scheduling.updatePoll(poll.id, { status: 'FINALIZED', finalProposalId: proposal.id, meetupId: meetup.id, ...(poll.votingClosedAt ? {} : { votingClosedAt: now }) });
    const card: MessageRecord = { id: ids.next(), conversationId: poll.conversationId, senderId: poll.organizerId, kind: 'MEETUP', body: `Encontro: ${poll.title}`, suggestion: null, response: null, respondedAt: null, meetupId: meetup.id, createdAt: now };
    await conversations.addMessage(card);
    const when = whenFmt(poll, chosen, startsAt);
    const defined = `${decidedWord(poll)} ${poll.schedulingMode === 'BEST_DATE' ? 'definida' : 'definido'}`;
    await this.postSystem(poll.conversationId, poll.organizerId, `${defined}: ${when} para "${poll.title}". ${going.length} ${going.length === 1 ? 'pessoa confirmada' : 'pessoas confirmadas'}.`, now);
    await this.notifyAll(poll.organizerId, going.filter((id) => id !== poll.organizerId), poll, `${defined}: ${when}`, `Você está confirmado em "${poll.title}". Veja na sua agenda.`);
    return this.view(actorId, { ...poll, status: 'FINALIZED', finalProposalId: proposal.id, meetupId: meetup.id });
  }

  /** Quem organiza desiste da data proposta e a votação volta a ficar aberta. */
  async withdraw(actorId: string, pollId: unknown): Promise<PollView> {
    const { scheduling } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação mexe na proposta');
    const open = poll.status === 'CONFIRMING' ? await this.openProposal(poll.id) : undefined;
    if (!open) throw conflict('Não há data em confirmação');
    await scheduling.updateProposal(open.id, { status: 'WITHDRAWN' });
    await scheduling.updatePoll(poll.id, { status: 'VOTING', votingClosedAt: null });
    return this.view(actorId, { ...poll, status: 'VOTING', votingClosedAt: null });
  }

  /** Cada convidado: confirmar, pedir ajuste na agenda ou recusar. A regra da votação decide se a data fecha. */
  async respond(actorId: string, pollId: unknown, answer: unknown): Promise<PollView> {
    const { scheduling, clock } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (answer !== 'CONFIRMED' && answer !== 'ADJUST' && answer !== 'DECLINED') throw validationError('Resposta inválida', { status: 'Use CONFIRMED, ADJUST ou DECLINED' });
    const open = poll.status === 'CONFIRMING' ? await this.openProposal(poll.id) : undefined;
    if (!open) throw conflict('Não há data esperando confirmação');
    const now = clock.now();
    await scheduling.setConfirmation(open.id, poll.id, actorId, answer, now);
    const outcome = await this.evaluate(poll, open, actorId);
    return this.view(actorId, outcome);
  }

  /** Decisão manual: quem organiza fecha a data com as confirmações que há. */
  async finalizeManual(actorId: string, pollId: unknown): Promise<PollView> {
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação fecha a data');
    if (poll.confirmationPolicy !== 'MANUAL') throw conflict('Esta votação fecha sozinha pela regra escolhida');
    const open = poll.status === 'CONFIRMING' ? await this.openProposal(poll.id) : undefined;
    if (!open) throw conflict('Não há data em confirmação');
    return this.view(actorId, await this.finalize(poll, open));
  }

  async cancel(actorId: string, pollId: unknown): Promise<PollView> {
    const { scheduling } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação cancela');
    if (poll.status === 'FINALIZED' || poll.status === 'CANCELLED') throw conflict('Esta votação já terminou');
    const open = await this.openProposal(poll.id);
    if (open) await scheduling.updateProposal(open.id, { status: 'WITHDRAWN' });
    await scheduling.updatePoll(poll.id, { status: 'CANCELLED' });
    const others = (await scheduling.listParticipants(poll.id)).map((p) => p.userId).filter((id) => id !== actorId);
    await this.postSystem(poll.conversationId, actorId, `${await this.nameOf(actorId)} cancelou a votação "${poll.title}"`, this.deps.clock.now());
    void others;
    return this.view(actorId, { ...poll, status: 'CANCELLED' });
  }

  // ---------- Internos ----------

  /**
   * Dia e horário de uma proposta: os informados ou, com `fallbackToBest`, os primeiros dos rankings. Votando só a data,
   * o horário é o fixo da votação; votando só o horário, o dia é o da votação.
   */
  private pick(poll: PollRecord, votes: readonly PollVoteRecord[], ids: readonly string[], date: unknown, time: unknown, fallbackToBest: boolean): { day: string; time: string; startsAt: Date; stats: DateStats } {
    const th = this.thresholds(poll);
    const empty = (v: unknown) => v === undefined || v === null || v === '';
    let day: unknown = poll.rangeStart;
    if (votesDays(poll)) {
      day = empty(date) && fallbackToBest ? rankDates(computeDateStats(dayKeys(poll), votes, ids, th))[0]?.date : date;
      if (!isDay(day) || day < poll.rangeStart || day > poll.rangeEnd) throw validationError('Dia fora do período', { date: `Só de ${dayFmt(poll.rangeStart)} a ${dayFmt(poll.rangeEnd)}` });
    } else if (!empty(date) && date !== poll.rangeStart && !(typeof date === 'string' && TIME_RE.test(date))) {
      throw validationError('Dia fora da votação', { date: `O dia é ${dayFmt(poll.rangeStart)}` });
    }
    let chosenTime: unknown = poll.preferredTimeStart ?? POLL_DEFAULT_START;
    if (votesTimes(poll)) {
      // Compatível com quem manda o horário no lugar do dia (votação só de horário).
      const given = empty(time) && !votesDays(poll) && typeof date === 'string' && TIME_RE.test(date) ? date : time;
      chosenTime = empty(given) && fallbackToBest ? rankDates(computeDateStats(timeKeys(poll), votes, ids, th))[0]?.date : given;
      if (typeof chosenTime !== 'string' || !(poll.candidateTimes ?? []).includes(chosenTime)) throw validationError('Horário fora da votação', { time: `Só ${(poll.candidateTimes ?? []).join(', ')}` });
    }
    const startsAt = zonedTimeToUtc(day as string, chosenTime as string, poll.timezone);
    if (startsAt <= this.deps.clock.now()) throw votesTimes(poll) ? validationError('Esse horário já passou', { time: 'Escolha um horário futuro' }) : validationError('Esse dia já passou', { date: 'Escolha uma data futura' });
    return { day: day as string, time: chosenTime as string, startsAt, stats: comboStats(poll, votes, ids, th, day as string, chosenTime as string) };
  }

  private thresholds(poll: PollRecord): Thresholds {
    return { green: poll.greenMin, orange: poll.orangeMin, minCoverage: poll.minCoverage };
  }

  private async openProposal(pollId: string): Promise<PollProposalRecord | undefined> {
    return (await this.deps.scheduling.listProposals(pollId)).find((p) => p.status === 'OPEN');
  }

  private requireVotingOpen(poll: PollRecord): void {
    if (poll.status !== 'VOTING') throw conflict(poll.status === 'CONFIRMING' ? 'A votação está em confirmação' : 'Esta votação já terminou');
    if (this.isClosed(poll)) throw conflict(poll.votingClosedAt ? 'A votação foi encerrada' : 'O prazo da votação acabou');
  }

  /** Encerrada à mão ou pelo prazo (que vale sozinho, sem precisar de ninguém). */
  private isClosed(poll: PollRecord): boolean {
    return poll.votingClosedAt != null || (poll.votingDeadline !== null && poll.votingDeadline <= this.deps.clock.now());
  }

  /**
   * Só quem participa da votação a vê. Votação comum: precisa ainda estar na conversa. Votação de evento: convidado que
   * ainda não aceitou (e por isso não está no grupo) vota mesmo assim.
   */
  private async accessible(actorId: string, pollId: unknown): Promise<PollRecord> {
    const poll = typeof pollId === 'string' && pollId !== '' && pollId.length <= 64 ? await this.deps.scheduling.find(pollId) : undefined;
    if (!poll) throw notFound('Votação não encontrada');
    const participants = await this.deps.scheduling.listParticipants(poll.id);
    if (!participants.some((p) => p.userId === actorId)) throw notFound('Votação não encontrada');
    if (!poll.eventPostId && !(await this.deps.conversations.participantIds(poll.conversationId))?.includes(actorId)) throw notFound('Votação não encontrada');
    if (poll.organizerId !== actorId && (await this.deps.blocks.existsEitherWay(actorId, poll.organizerId))) throw notFound('Votação não encontrada');
    return poll;
  }

  /** Aplica a regra de confirmação depois de uma resposta. */
  private async evaluate(poll: PollRecord, proposal: PollProposalRecord, responderId: string): Promise<PollRecord> {
    const { scheduling, clock } = this.deps;
    const participants = (await scheduling.listParticipants(poll.id)).map((p) => p.userId);
    const answers = new Map((await scheduling.listConfirmations(proposal.id)).map((c) => [c.userId, c.status] as const));
    const verdict = decideConfirmation(poll.confirmationPolicy, tallyConfirmations(participants, answers));
    if (verdict === 'FINALIZE') return this.finalize(poll, proposal);
    if (verdict === 'REJECT') {
      await scheduling.updateProposal(proposal.id, { status: 'REJECTED' });
      await scheduling.updatePoll(poll.id, { status: 'VOTING', votingClosedAt: null });
      const now = clock.now();
      const when = whenFmt(poll, proposal.candidateDate, proposal.candidateStartAt);
      await this.postSystem(poll.conversationId, responderId, `A proposta ${when} não passou. A votação voltou a ficar aberta.`, now);
      await this.deps.notifier.notify({ userId: poll.organizerId, type: 'MEETUP_INVITE', title: `${when} não passou`, body: `"${poll.title}" voltou para a votação.`, url: `/planejar/${poll.id}`, dedupeKey: `poll-rejected:${proposal.id}` });
      return { ...poll, status: 'VOTING', votingClosedAt: null };
    }
    return poll;
  }

  /** Fecha a data: cria o encontro no calendário interno, avisa a conversa e os participantes. */
  private async finalize(poll: PollRecord, proposal: PollProposalRecord): Promise<PollRecord> {
    const { scheduling, meetups, conversations, clock, ids } = this.deps;
    const now = clock.now();
    const participants = (await scheduling.listParticipants(poll.id)).map((p) => p.userId);
    const answers = new Map((await scheduling.listConfirmations(proposal.id)).map((c) => [c.userId, c.status] as const));
    const meetup: MeetupRecord = {
      id: ids.next(),
      organizerId: poll.organizerId,
      conversationId: poll.conversationId,
      eventId: null,
      eventPostId: poll.eventPostId ?? null,
      title: poll.title,
      startsAt: proposal.candidateStartAt,
      endsAt: proposal.candidateEndAt,
      status: 'ACTIVE',
      createdAt: now,
      participants: participants.map((userId) => {
        if (userId === poll.organizerId) return { userId, status: 'CONFIRMED' as const, respondedAt: now };
        const a = answers.get(userId);
        if (a === 'CONFIRMED') return { userId, status: 'CONFIRMED' as const, respondedAt: now };
        if (a === 'DECLINED') return { userId, status: 'DECLINED' as const, respondedAt: now };
        return { userId, status: 'INVITED' as const, respondedAt: null };
      }),
    };
    await meetups.create(meetup);
    await this.fillEventDate(poll, proposal.candidateStartAt, proposal.candidateEndAt, meetup.participants.filter((p) => p.status === 'CONFIRMED').map((p) => p.userId));
    await scheduling.updateProposal(proposal.id, { status: 'CONFIRMED' });
    await scheduling.updatePoll(poll.id, { status: 'FINALIZED', finalProposalId: proposal.id, meetupId: meetup.id });
    const card: MessageRecord = { id: ids.next(), conversationId: poll.conversationId, senderId: poll.organizerId, kind: 'MEETUP', body: `Encontro: ${poll.title}`, suggestion: null, response: null, respondedAt: null, meetupId: meetup.id, createdAt: now };
    await conversations.addMessage(card);
    const when = whenFmt(poll, proposal.candidateDate, proposal.candidateStartAt);
    const defined = `${decidedWord(poll)} ${poll.schedulingMode === 'BEST_DATE' ? 'definida' : 'definido'}`;
    await this.postSystem(poll.conversationId, poll.organizerId, `${defined}: ${when} para "${poll.title}"`, now);
    await this.notifyAll(poll.organizerId, participants.filter((id) => id !== poll.organizerId), poll, `${defined}: ${when}`, `"${poll.title}" está marcado. Veja na sua agenda.`);
    return { ...poll, status: 'FINALIZED', finalProposalId: proposal.id, meetupId: meetup.id };
  }

  /** O evento (seu, de pessoa) que espera a votação para ter data: sem data, não arquivado e sem outra votação. */
  private async undatedEvent(actorId: string, raw: unknown): Promise<string> {
    const invalid = () => validationError('Evento inválido', { eventPostId: 'Evento não encontrado' });
    if (typeof raw !== 'string' || raw.length > 64) throw invalid();
    const post = (await this.deps.posts.findById(raw))?.post;
    if (!post || post.authorId !== actorId || post.eventTitle === null || post.archivedAt !== null) throw invalid();
    if (post.eventStartsAt !== null) throw conflict('Este evento já tem data');
    const other = await this.deps.scheduling.findByEventPost(post.id);
    if (other && other.status !== 'CANCELLED') throw conflict('Este evento já tem uma votação');
    return post.id;
  }

  /** Quem foi convidado para o evento: marcado na criação, convidado registrado ou numa conversa em que quem criou mandou o evento (menos quem tem bloqueio). */
  private async inviteesOf(organizerId: string, postId: string): Promise<string[]> {
    const { conversations, blocks, posts } = this.deps;
    const related = new Set(await blocks.listRelatedIds(organizerId));
    const out = new Set<string>();
    for (const invite of await posts.listInvites(postId)) if (invite.userId !== organizerId && !related.has(invite.userId)) out.add(invite.userId);
    for (const id of await conversations.postEventConversationIds(postId, organizerId)) {
      for (const userId of (await conversations.participantIds(id)) ?? []) if (userId !== organizerId && !related.has(userId)) out.add(userId);
    }
    return [...out];
  }

  /**
   * Grupo da votação de um evento sem data e quem vota nela. Vota todo convidado; no grupo só entra quem já aceitou ("Eu vou").
   * Quem aceitar depois entra no grupo nessa hora.
   */
  private async eventGroup(actorId: string, rawPostId: unknown): Promise<{ conversationId: string; voters: string[] }> {
    const { conversations, posts, eventRoom, blocks, clock, ids } = this.deps;
    const postId = await this.undatedEvent(actorId, rawPostId);
    const invitees = await this.inviteesOf(actorId, postId);
    if (invitees.length === 0) throw validationError('Convide alguém para o evento primeiro', { eventPostId: 'Mande o evento para quem vai votar na data' });
    const related = new Set(await blocks.listRelatedIds(actorId));
    const going = (await eventRoom.listGoing({ source: 'USER', id: postId })).map((g) => g.userId).filter((id) => id !== actorId && !related.has(id));
    const voters = [...new Set([...invitees, ...going])];
    // O evento já tem grupo (criado pela página do evento) em que você está: a votação abre nele.
    for (const id of await conversations.groupIdsForEventPost(postId)) {
      if (((await conversations.participantIds(id)) ?? []).includes(actorId)) return { conversationId: id, voters };
    }
    const now = clock.now();
    const title = (await posts.findById(postId))?.post.eventTitle ?? 'Evento';
    const group = await conversations.createGroup({ id: ids.next(), name: Array.from(title).slice(0, EVENT_GROUP_NAME_MAX).join(''), ownerId: actorId, now, eventPostId: postId });
    for (const userId of going.slice(0, EVENT_GROUP_CAPACITY - 1)) await conversations.addParticipant(group.id, userId, now);
    await conversations.markRead(group.id, actorId, now);
    return { conversationId: group.id, voters };
  }

  /**
   * Quem criou o evento mandou ele para mais gente enquanto a data está em votação: as pessoas novas entram na votação,
   * com aviso. No grupo do evento elas só entram quando aceitarem ("Eu vou"). Chamado depois de cada envio do evento numa conversa.
   */
  async addEventInvitees(senderId: string, postId: string, conversationId: string): Promise<void> {
    const { scheduling, conversations, blocks, clock } = this.deps;
    const poll = await scheduling.findByEventPost(postId);
    if (!poll || poll.status !== 'VOTING' || poll.organizerId !== senderId || poll.conversationId === conversationId) return;
    const related = new Set(await blocks.listRelatedIds(senderId));
    const inPoll = new Set((await scheduling.listParticipants(poll.id)).map((p) => p.userId));
    const newcomers = ((await conversations.participantIds(conversationId)) ?? []).filter((id) => id !== senderId && !related.has(id) && !inPoll.has(id));
    if (newcomers.length === 0) return;
    const now = clock.now();
    for (const userId of newcomers) await scheduling.addParticipant(poll.id, userId, now);
    const name = await this.nameOf(senderId);
    await this.postSystem(poll.conversationId, senderId, newcomers.length === 1 ? `${name} convidou mais uma pessoa para "${poll.title}"` : `${name} convidou mais ${newcomers.length} pessoas para "${poll.title}"`, now);
    await this.notifyAll(senderId, newcomers, poll, `${name} quer achar a melhor data`, `${poll.title}: marque os dias em que você pode.`);
  }

  /** Votação de um evento sem data: o dia escolhido vira a data do evento, e quem confirmou já vai. */
  private async fillEventDate(poll: PollRecord, startsAt: Date, endsAt: Date, going: readonly string[]): Promise<void> {
    if (!poll.eventPostId) return;
    const { posts, eventRoom, clock } = this.deps;
    const post = (await posts.findById(poll.eventPostId))?.post;
    if (!post || post.eventTitle === null || post.eventStartsAt !== null) return;
    await posts.update(post.id, post.authorId, {
      caption: post.caption,
      placeName: post.placeName,
      placeAddress: post.placeAddress,
      eventTitle: post.eventTitle,
      eventStartsAt: startsAt,
      eventEndsAt: endsAt,
      eventKind: post.eventKind,
      editedAt: clock.now(),
    });
    const ref = { source: 'USER' as const, id: post.id };
    // O dono entra com o evento na aba Eventos (presença do dono fora do perfil quer dizer que ele tirou o evento de lá).
    for (const userId of new Set([post.authorId, ...going])) await eventRoom.addGoing(ref, userId, clock.now(), userId === post.authorId);
    // Quem confirmou a data aceitou o evento: entra no grupo dele (quem já estava continua).
    for (const userId of new Set(going)) if (userId !== post.authorId) await joinEventGroups(this.deps, post.id, userId);
  }

  private async nameOf(userId: string): Promise<string> {
    const p = await this.deps.users.findProfileById(userId);
    return p?.displayName ?? p?.username ?? 'Alguém';
  }

  private async postSystem(conversationId: string, senderId: string, body: string, now: Date): Promise<void> {
    await this.deps.conversations.addMessage({ id: this.deps.ids.next(), conversationId, senderId, kind: 'SYSTEM', body, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
  }

  private async notifyAll(actorId: string, userIds: string[], poll: PollRecord, title: string, body: string): Promise<void> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(actorId));
    for (const userId of userIds) {
      if (userId === actorId || hidden.has(userId)) continue;
      await this.deps.notifier.notify({ userId, type: 'MEETUP_INVITE', title, body, url: `/planejar/${poll.id}`, dedupeKey: `poll:${poll.id}:${title}`, actorId });
    }
  }

  private async summaries(actorId: string, polls: PollRecord[]): Promise<PollSummary[]> {
    const { scheduling } = this.deps;
    const out: PollSummary[] = [];
    for (const p of polls) {
      const participants = await scheduling.listParticipants(p.id);
      const mine = participants.find((x) => x.userId === actorId);
      if (!mine) continue;
      let best: PollSummary['best'] = null;
      const allVotes = await scheduling.listVotes(p.id);
      const votedCount = new Set(allVotes.map((v) => v.userId)).size;
      if (p.status === 'VOTING') {
        const ids = participants.map((x) => x.userId);
        const th = this.thresholds(p);
        const topDay = votesDays(p) ? rankDates(computeDateStats(dayKeys(p), allVotes, ids, th))[0] : undefined;
        const topTime = votesTimes(p) ? rankDates(computeDateStats(timeKeys(p), allVotes, ids, th))[0] : undefined;
        const enough = (!votesDays(p) || (topDay !== undefined && hasEnoughData([topDay]))) && (!votesTimes(p) || (topTime !== undefined && hasEnoughData([topTime])));
        if (enough) {
          const day = topDay?.date ?? p.rangeStart;
          const time = topTime?.date ?? null;
          const combo = comboStats(p, allVotes, ids, th, day, time ?? '');
          best = { date: day, time, compatibility: combo.compatibility, coverage: combo.coverage };
        }
      }
      let proposedDate: string | null = null;
      let needsMyConfirmation = false;
      let finalDate: string | null = null;
      if (p.status === 'CONFIRMING') {
        const open = await this.openProposal(p.id);
        proposedDate = open?.candidateDate ?? null;
        if (open) needsMyConfirmation = !(await scheduling.listConfirmations(open.id)).some((c) => c.userId === actorId);
      }
      let finalEndsAt: string | null = null;
      if (p.status === 'FINALIZED' && p.finalProposalId) {
        const fin = await scheduling.findProposal(p.finalProposalId);
        finalDate = fin?.candidateDate ?? null;
        finalEndsAt = fin ? fin.candidateEndAt.toISOString() : null;
      }
      const eventPost = p.eventPostId ? await this.deps.posts.findById(p.eventPostId) : undefined;
      const event = eventPost?.post.eventTitle ? { id: eventPost.post.id, title: eventPost.post.eventTitle, startsAt: eventPost.post.eventStartsAt ? eventPost.post.eventStartsAt.toISOString() : null, endsAt: eventPost.post.eventEndsAt ? eventPost.post.eventEndsAt.toISOString() : null } : null;
      out.push({ id: p.id, conversationId: p.conversationId, title: p.title, mode: p.schedulingMode, status: p.status, rangeStart: p.rangeStart, rangeEnd: p.rangeEnd, finalDate, needsMyVote: p.status === 'VOTING' && !this.isClosed(p) && mine.finishedAt === null, needsMyConfirmation, participantCount: participants.length, votedCount, finalEndsAt, finishedCount: participants.filter((x) => x.finishedAt !== null).length, best, proposedDate, votingDeadline: p.votingDeadline ? p.votingDeadline.toISOString() : null, meetupId: p.meetupId ?? null, event });
    }
    return out;
  }

  private async view(actorId: string, poll: PollRecord): Promise<PollView> {
    const { scheduling, users, conversations, blocks, clock } = this.deps;
    const [participants, votes, proposals, conversation, members] = await Promise.all([scheduling.listParticipants(poll.id), scheduling.listVotes(poll.id), scheduling.listProposals(poll.id), conversations.findById(poll.conversationId), conversations.participantIds(poll.conversationId)]);
    const hidden = new Set(await blocks.listRelatedIds(actorId));
    const profiles = new Map((await users.findProfilesByIds(participants.map((p) => p.userId))).map((p) => [p.userId, p] as const));
    const organizer = profiles.get(poll.organizerId) ?? (await users.findProfileById(poll.organizerId));
    if (!organizer) throw notFound('Votação não encontrada');

    const th = this.thresholds(poll);
    const ids = participants.map((p) => p.userId);
    const days = computeDateStats(dayKeys(poll), votes, ids, th);
    const times = computeDateStats(timeKeys(poll), votes, ids, th);
    const ranking = rankDates(days);
    const timeRanking = rankDates(times);
    const open = proposals.find((p) => p.status === 'OPEN');
    const confirmations = open ? await scheduling.listConfirmations(open.id) : [];
    const answers = new Map(confirmations.map((c) => [c.userId, c.status] as const));
    const final = poll.status === 'FINALIZED' ? proposals.find((p) => p.id === poll.finalProposalId) : undefined;
    const myVotes: Record<string, VoteStatus> = {};
    const options = new Set([...days, ...times].map((d) => d.date));
    for (const v of votes) if (v.userId === actorId && options.has(v.date)) myVotes[v.date] = v.status;
    const me = participants.find((p) => p.userId === actorId);

    return {
      id: poll.id,
      conversationId: poll.conversationId,
      conversationName: conversation?.type === 'GROUP' ? conversation.name : null,
      isGroup: conversation?.type === 'GROUP',
      inConversation: members?.includes(actorId) ?? false,
      eventPostId: poll.eventPostId ?? null,
      title: poll.title,
      mode: poll.schedulingMode,
      candidateTimes: timeKeys(poll),
      status: poll.status,
      organizer: toPublicProfile(organizer),
      isOrganizer: poll.organizerId === actorId,
      rangeStart: poll.rangeStart,
      rangeEnd: poll.rangeEnd,
      durationMinutes: poll.durationMinutes,
      preferredTimeStart: poll.preferredTimeStart,
      timezone: poll.timezone,
      votingDeadline: poll.votingDeadline ? poll.votingDeadline.toISOString() : null,
      votingOpen: poll.status === 'VOTING' && !this.isClosed(poll),
      votingClosed: poll.status === 'VOTING' && this.isClosed(poll),
      canClose: poll.status === 'VOTING' && poll.organizerId === actorId && !this.isClosed(poll) && participants.every((p) => p.finishedAt !== null),
      confirmationPolicy: poll.confirmationPolicy,
      thresholds: th,
      participants: participants.flatMap((p) => {
        const prof = profiles.get(p.userId);
        if (!prof || (hidden.has(p.userId) && p.userId !== actorId)) return [];
        return [{ profile: toPublicProfile(prof), finished: p.finishedAt !== null, confirmation: answers.get(p.userId) ?? null }];
      }),
      days,
      times,
      myVotes,
      iFinished: me?.finishedAt != null,
      ranking,
      timeRanking,
      enoughData: (!votesDays(poll) || hasEnoughData(ranking)) && (!votesTimes(poll) || hasEnoughData(timeRanking)),
      proposal: open ? { ...present(open), tally: tallyConfirmations(ids, answers), myConfirmation: answers.get(actorId) ?? null } : null,
      history: proposals.filter((p) => p.status !== 'OPEN').map(present),
      final: final ? { date: final.candidateDate, startsAt: final.candidateStartAt.toISOString(), endsAt: final.candidateEndAt.toISOString(), meetupId: poll.meetupId } : null,
      createdAt: poll.createdAt.toISOString(),
    };
  }
}
