import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import { computeDateStats, dateRange, daysBetween, decideConfirmation, hasEnoughData, isDay, isTimeZone, rankDates, tallyConfirmations, todayIn, VOTE_STATUSES, zonedTimeToUtc } from './scheduling.ts';
import type { ConfirmationPolicy, ConfirmationStatus, ConfirmationTally, DateStats, Thresholds, VoteStatus } from './scheduling.ts';
import type { MeetupRecord, MessageRecord, PollProposalRecord, PollRecord, PollStatus, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

export const POLL_TITLE_MAX = 120;
/** Dias que cabem num intervalo (inclusive). */
export const POLL_MAX_DAYS = 60;
export const POLL_DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
export const POLL_DEFAULT_START = '19:00';

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
  title: string;
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
  /** Todos os dias do intervalo, com os números do mapa de calor. */
  days: DateStats[];
  /** Seus votos por dia. Dia sem voto = sem resposta. */
  myVotes: Record<string, VoteStatus>;
  iFinished: boolean;
  /** Melhores datas, da melhor para a pior. */
  ranking: DateStats[];
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
  best: { date: string; compatibility: number | null; coverage: number } | null;
  /** Data proposta, enquanto espera confirmação. */
  proposedDate: string | null;
  votingDeadline: string | null;
  /** Encontro (agenda) gerado ao definir a data. */
  meetupId: string | null;
  /** Evento criado a partir desta votação; quando existe, substitui a votação nas listas do grupo. */
  event: { id: string; title: string; startsAt: string; endsAt: string } | null;
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

/** "Encontrar a melhor data": votação de disponibilidade, ranking, confirmação e fechamento da data. */
export class SchedulingService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  // ---------- Criar ----------

  /** Abre a votação numa conversa sua (grupo ou 1 a 1). Entram todos os membros da conversa, menos quem tem bloqueio com você. */
  async create(actorId: string, conversationId: unknown, input: PollInput): Promise<PollView> {
    const { conversations, blocks, follows, scheduling, clock, ids } = this.deps;
    const conversation = typeof conversationId === 'string' && conversationId !== '' && conversationId.length <= 64 ? await conversations.findById(conversationId) : undefined;
    const members = conversation ? await conversations.participantIds(conversation.id) : undefined;
    if (!conversation || !members || !members.includes(actorId)) throw notFound('Conversa não encontrada');

    const related = new Set(await blocks.listRelatedIds(actorId));
    let others = members.filter((id) => id !== actorId && !related.has(id));
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

    const duration = input.durationMinutes === undefined || input.durationMinutes === null ? 180 : input.durationMinutes;
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 15 || duration > 1440) throw validationError('Duração inválida', { durationMinutes: 'De 15 minutos a 24 horas' });

    let preferred: string | null = null;
    if (input.preferredTimeStart !== undefined && input.preferredTimeStart !== null && input.preferredTimeStart !== '') {
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

    const poll: PollRecord = {
      id: ids.next(),
      conversationId: conversation.id,
      organizerId: actorId,
      title,
      schedulingMode: 'BEST_DATE',
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

    const name = await this.nameOf(actorId);
    await this.postSystem(conversation.id, actorId, `${name} abriu uma votação de datas: ${title}`, now);
    await this.notifyAll(actorId, others, poll, `${name} quer achar a melhor data`, `${title}: marque os dias em que você pode.`);
    return this.view(actorId, poll);
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
    if (!Array.isArray(input.dates) || input.dates.length === 0 || input.dates.length > POLL_MAX_DAYS) throw validationError('Escolha os dias', { dates: `Envie de 1 a ${POLL_MAX_DAYS} dias` });
    const today = todayIn(poll.timezone, clock.now());
    const dates = [...new Set(input.dates)];
    for (const d of dates) {
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
  async propose(actorId: string, pollId: unknown, date: unknown): Promise<PollView> {
    const { scheduling, clock, ids } = this.deps;
    const poll = await this.accessible(actorId, pollId);
    if (poll.organizerId !== actorId) throw forbidden('Só quem criou a votação escolhe a data');
    if (poll.status !== 'VOTING') throw conflict(poll.status === 'CONFIRMING' ? 'Já existe uma data em confirmação' : 'Esta votação já terminou');
    if (!isDay(date) || date < poll.rangeStart || date > poll.rangeEnd) throw validationError('Dia fora do período', { date: `Só de ${dayFmt(poll.rangeStart)} a ${dayFmt(poll.rangeEnd)}` });

    const now = clock.now();
    const startsAt = zonedTimeToUtc(date, poll.preferredTimeStart ?? POLL_DEFAULT_START, poll.timezone);
    if (startsAt <= now) throw validationError('Esse dia já passou', { date: 'Escolha uma data futura' });
    const endsAt = new Date(startsAt.getTime() + poll.durationMinutes * 60_000);

    const participants = await scheduling.listParticipants(poll.id);
    const stats = computeDateStats([date], await scheduling.listVotes(poll.id), participants.map((p) => p.userId), this.thresholds(poll))[0]!;
    const proposal: PollProposalRecord = {
      id: ids.next(),
      pollId: poll.id,
      candidateDate: date,
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
    await this.postSystem(poll.conversationId, actorId, `${name} propôs ${dayFmt(date)} para "${poll.title}". Confirme sua presença.`, now);
    await this.notifyAll(actorId, participants.map((p) => p.userId).filter((id) => id !== actorId), poll, `Confirme a data: ${dayFmt(date)}`, `${name} escolheu ${dayFmt(date)} para "${poll.title}".`);
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

  /** Só quem participa da votação (e ainda está na conversa) a vê. */
  private async accessible(actorId: string, pollId: unknown): Promise<PollRecord> {
    const poll = typeof pollId === 'string' && pollId !== '' && pollId.length <= 64 ? await this.deps.scheduling.find(pollId) : undefined;
    if (!poll) throw notFound('Votação não encontrada');
    const participants = await this.deps.scheduling.listParticipants(poll.id);
    const members = await this.deps.conversations.participantIds(poll.conversationId);
    if (!participants.some((p) => p.userId === actorId) || !members?.includes(actorId)) throw notFound('Votação não encontrada');
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
      await this.postSystem(poll.conversationId, responderId, `A data ${dayFmt(proposal.candidateDate)} não passou. A votação voltou a ficar aberta.`, now);
      await this.deps.notifier.notify({ userId: poll.organizerId, type: 'MEETUP_INVITE', title: `Data ${dayFmt(proposal.candidateDate)} não passou`, body: `"${poll.title}" voltou para a votação.`, url: `/planejar/${poll.id}`, dedupeKey: `poll-rejected:${proposal.id}` });
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
    await scheduling.updateProposal(proposal.id, { status: 'CONFIRMED' });
    await scheduling.updatePoll(poll.id, { status: 'FINALIZED', finalProposalId: proposal.id, meetupId: meetup.id });
    const card: MessageRecord = { id: ids.next(), conversationId: poll.conversationId, senderId: poll.organizerId, kind: 'MEETUP', body: `Encontro: ${poll.title}`, suggestion: null, response: null, respondedAt: null, meetupId: meetup.id, createdAt: now };
    await conversations.addMessage(card);
    await this.postSystem(poll.conversationId, poll.organizerId, `Data definida: ${dayFmt(proposal.candidateDate)} para "${poll.title}"`, now);
    await this.notifyAll(poll.organizerId, participants.filter((id) => id !== poll.organizerId), poll, `Data definida: ${dayFmt(proposal.candidateDate)}`, `"${poll.title}" está marcado. Veja na sua agenda.`);
    return { ...poll, status: 'FINALIZED', finalProposalId: proposal.id, meetupId: meetup.id };
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
      await this.deps.notifier.notify({ userId, type: 'MEETUP_INVITE', title, body, url: `/planejar/${poll.id}`, dedupeKey: `poll:${poll.id}:${title}` });
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
        const days = computeDateStats(dateRange(p.rangeStart, p.rangeEnd), allVotes, participants.map((x) => x.userId), this.thresholds(p));
        const top = rankDates(days)[0];
        if (top && hasEnoughData([top])) best = { date: top.date, compatibility: top.compatibility, coverage: top.coverage };
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
      const event = eventPost?.post.eventTitle && eventPost.post.eventStartsAt && eventPost.post.eventEndsAt ? { id: eventPost.post.id, title: eventPost.post.eventTitle, startsAt: eventPost.post.eventStartsAt.toISOString(), endsAt: eventPost.post.eventEndsAt.toISOString() } : null;
      out.push({ id: p.id, conversationId: p.conversationId, title: p.title, status: p.status, rangeStart: p.rangeStart, rangeEnd: p.rangeEnd, finalDate, needsMyVote: p.status === 'VOTING' && !this.isClosed(p) && mine.finishedAt === null, needsMyConfirmation, participantCount: participants.length, votedCount, finalEndsAt, finishedCount: participants.filter((x) => x.finishedAt !== null).length, best, proposedDate, votingDeadline: p.votingDeadline ? p.votingDeadline.toISOString() : null, meetupId: p.meetupId ?? null, event });
    }
    return out;
  }

  private async view(actorId: string, poll: PollRecord): Promise<PollView> {
    const { scheduling, users, conversations, blocks, clock } = this.deps;
    const [participants, votes, proposals, conversation] = await Promise.all([scheduling.listParticipants(poll.id), scheduling.listVotes(poll.id), scheduling.listProposals(poll.id), conversations.findById(poll.conversationId)]);
    const hidden = new Set(await blocks.listRelatedIds(actorId));
    const profiles = new Map((await users.findProfilesByIds(participants.map((p) => p.userId))).map((p) => [p.userId, p] as const));
    const organizer = profiles.get(poll.organizerId) ?? (await users.findProfileById(poll.organizerId));
    if (!organizer) throw notFound('Votação não encontrada');

    const th = this.thresholds(poll);
    const ids = participants.map((p) => p.userId);
    const days = computeDateStats(dateRange(poll.rangeStart, poll.rangeEnd), votes, ids, th);
    const ranking = rankDates(days);
    const open = proposals.find((p) => p.status === 'OPEN');
    const confirmations = open ? await scheduling.listConfirmations(open.id) : [];
    const answers = new Map(confirmations.map((c) => [c.userId, c.status] as const));
    const final = poll.status === 'FINALIZED' ? proposals.find((p) => p.id === poll.finalProposalId) : undefined;
    const myVotes: Record<string, VoteStatus> = {};
    for (const v of votes) if (v.userId === actorId) myVotes[v.date] = v.status;
    const me = participants.find((p) => p.userId === actorId);

    return {
      id: poll.id,
      conversationId: poll.conversationId,
      conversationName: conversation?.type === 'GROUP' ? conversation.name : null,
      isGroup: conversation?.type === 'GROUP',
      title: poll.title,
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
      myVotes,
      iFinished: me?.finishedAt != null,
      ranking,
      enoughData: hasEnoughData(ranking),
      proposal: open ? { ...present(open), tally: tallyConfirmations(ids, answers), myConfirmation: answers.get(actorId) ?? null } : null,
      history: proposals.filter((p) => p.status !== 'OPEN').map(present),
      final: final ? { date: final.candidateDate, startsAt: final.candidateStartAt.toISOString(), endsAt: final.candidateEndAt.toISOString(), meetupId: poll.meetupId } : null,
      createdAt: poll.createdAt.toISOString(),
    };
  }
}
