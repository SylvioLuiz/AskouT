import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DomainError } from '../errors.ts';
import type { ConversationRepository, MeetupRepository, NotificationRepository, ProfileEventRepository, PushSubscriptionRepository, PlaceRepository, AvailabilityRepository, FlashRepository, BlockRepository, FollowRepository, PendingSignupRepository, UserRepository } from '../ports.ts';
import type { MeetupRecord, MessageRecord, PlaceEventRecord, SuggestionCard, VenueRecord, PendingSignup, Profile, User, UserStatus } from '../types.ts';

/**
 * Suíte de contrato das portas de dados. Roda contra QUALQUER implementação:
 * hoje nos repositórios em memória; na máquina com Postgres, nos repositórios Prisma.
 * Garante que o comportamento que as regras de negócio assumem vale nas duas.
 */

export interface RepoHarness {
  users: UserRepository;
  follows: FollowRepository;
  blocks: BlockRepository;
  pending: PendingSignupRepository;
  availability: AvailabilityRepository;
  flash: FlashRepository;
  conversations: ConversationRepository;
  places: PlaceRepository;
  meetups: MeetupRepository;
  profileEvents: ProfileEventRepository;
  notifications: NotificationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  setUserStatus(userId: string, status: UserStatus): Promise<void>;
  /** Apaga todos os dados entre os testes. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const T0 = Date.parse('2026-10-13T12:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000);

export function defineRepositoryContract(
  name: string,
  makeHarness: () => Promise<RepoHarness>,
  options: { skip?: string | false } = {},
): void {
  describe(`contrato dos repositórios: ${name}`, { skip: options.skip ?? false }, () => {
    let h: RepoHarness;

    before(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
    });
    after(async () => {
      await h.close();
    });

    async function newUser(
      username: string,
      extra: { displayName?: string; isPrivate?: boolean; bio?: string | null } = {},
    ): Promise<string> {
      const id = randomUUID();
      const user: User = {
        id,
        email: `${username}@exemplo.com`,
        passwordHash: 'scrypt$1024$8$1$c2FsdA==$a2V5',
        status: 'ACTIVE',
        role: 'USER',
        createdAt: at(0),
      };
      const profile: Profile = {
        userId: id,
        username,
        displayName: extra.displayName ?? username,
        bio: extra.bio ?? null,
        avatarUrl: null,
        isPrivate: extra.isPrivate ?? false,
      };
      await h.users.create(user, profile);
      return id;
    }

    async function rejectsConflict(promise: Promise<unknown>, field: string): Promise<void> {
      let caught: unknown;
      try {
        await promise;
      } catch (e) {
        caught = e;
      }
      assert.ok(caught instanceof DomainError, `esperava DomainError, veio ${String(caught)}`);
      assert.equal(caught.code, 'CONFLICT');
      assert.ok(caught.details?.[field], `esperava details.${field}`);
    }

    // ---------- Usuários e perfis ----------

    describe('usuários', () => {
      it('cria e encontra por id, e-mail e username, preservando os campos', async () => {
        const id = randomUUID();
        await h.users.create(
          { id, email: 'ana@exemplo.com', passwordHash: 'hash-x', status: 'ACTIVE', role: 'VENUE_OWNER', createdAt: at(5) },
          { userId: id, username: 'ana.silva', displayName: 'Ana Silva', bio: 'oi\ntudo bem', avatarUrl: 'https://x.com/a.png', isPrivate: true },
        );

        const byId = await h.users.findById(id);
        assert.ok(byId);
        assert.equal(byId.email, 'ana@exemplo.com');
        assert.equal(byId.passwordHash, 'hash-x');
        assert.equal(byId.status, 'ACTIVE');
        assert.equal(byId.role, 'VENUE_OWNER');
        assert.equal(byId.createdAt.getTime(), at(5).getTime());

        assert.equal((await h.users.findByEmail('ana@exemplo.com'))?.id, id);

        const profile = await h.users.findProfileById(id);
        assert.deepEqual(profile, {
          userId: id,
          username: 'ana.silva',
          displayName: 'Ana Silva',
          bio: 'oi\ntudo bem',
          avatarUrl: 'https://x.com/a.png',
          isPrivate: true,
        });
        assert.deepEqual(await h.users.findProfileByUsername('ana.silva'), profile);
      });

      it('devolve undefined para inexistentes e para ids que não são UUID', async () => {
        assert.equal(await h.users.findById(randomUUID()), undefined);
        assert.equal(await h.users.findById('nao-e-uuid'), undefined);
        assert.equal(await h.users.findProfileById('nao-e-uuid'), undefined);
        assert.equal(await h.users.findByEmail('ninguem@exemplo.com'), undefined);
        assert.equal(await h.users.findProfileByUsername('ninguem'), undefined);
      });

      it('barra e-mail e username repetidos com CONFLICT e não deixa registro pela metade', async () => {
        await newUser('ana');

        const dupEmailId = randomUUID();
        await rejectsConflict(
          h.users.create(
            { id: dupEmailId, email: 'ana@exemplo.com', passwordHash: 'h', status: 'ACTIVE', role: 'USER', createdAt: at(0) },
            { userId: dupEmailId, username: 'outra', displayName: 'Outra', bio: null, avatarUrl: null, isPrivate: false },
          ),
          'email',
        );
        assert.equal(await h.users.findById(dupEmailId), undefined);
        assert.equal(await h.users.findProfileByUsername('outra'), undefined);

        const dupNameId = randomUUID();
        await rejectsConflict(
          h.users.create(
            { id: dupNameId, email: 'outro@exemplo.com', passwordHash: 'h', status: 'ACTIVE', role: 'USER', createdAt: at(0) },
            { userId: dupNameId, username: 'ana', displayName: 'Outra', bio: null, avatarUrl: null, isPrivate: false },
          ),
          'username',
        );
        assert.equal(await h.users.findById(dupNameId), undefined);
        assert.equal(await h.users.findByEmail('outro@exemplo.com'), undefined);
      });

      it('atualiza o perfil', async () => {
        const id = await newUser('ana');
        const current = (await h.users.findProfileById(id))!;
        await h.users.updateProfile({ ...current, displayName: 'Ana Luiza', bio: 'nova', avatarUrl: 'https://x.com/b.png', isPrivate: true });
        const after = (await h.users.findProfileById(id))!;
        assert.equal(after.displayName, 'Ana Luiza');
        assert.equal(after.bio, 'nova');
        assert.equal(after.avatarUrl, 'https://x.com/b.png');
        assert.equal(after.isPrivate, true);
        assert.equal(after.username, 'ana');

        await h.users.updateProfile({ ...after, bio: null, avatarUrl: null });
        const cleared = (await h.users.findProfileById(id))!;
        assert.equal(cleared.bio, null);
        assert.equal(cleared.avatarUrl, null);
      });

      it('findProfilesByIds mantém a ordem pedida, ignora ausentes e suspensos', async () => {
        const a = await newUser('ana');
        const b = await newUser('bia');
        const c = await newUser('caio');
        await h.setUserStatus(b, 'SUSPENDED');

        const found = await h.users.findProfilesByIds([c, randomUUID(), a, b]);
        assert.deepEqual(found.map((p) => p.username), ['caio', 'ana']);
        assert.deepEqual(await h.users.findProfilesByIds([]), []);
      });

      it('busca por prefixo de username ou trecho do nome, sem diferenciar maiúsculas', async () => {
        const eu = await newUser('eumesmo', { displayName: 'Eu Mesmo' });
        await newUser('maria', { displayName: 'Maria Souza' });
        await newUser('mariana', { displayName: 'Mariana' });
        await newUser('joao', { displayName: 'João da MARIA' });
        await newUser('pedro', { displayName: 'Pedro' });
        const suspenso = await newUser('mariano', { displayName: 'Mariano' });
        await h.setUserStatus(suspenso, 'SUSPENDED');

        const found = await h.users.searchProfiles('maria', 10, [eu]);
        assert.deepEqual(found.map((p) => p.username), ['joao', 'maria', 'mariana']);
      });

      it('busca respeita excludeIds e o limite', async () => {
        const a = await newUser('luza');
        await newUser('luzb');
        await newUser('luzc');
        assert.deepEqual((await h.users.searchProfiles('luz', 10, [a])).map((p) => p.username), ['luzb', 'luzc']);
        assert.deepEqual((await h.users.searchProfiles('luz', 2, [])).map((p) => p.username), ['luza', 'luzb']);
        assert.deepEqual(await h.users.searchProfiles('zzz', 10, []), []);
      });
    });

    // ---------- Seguimentos ----------

    describe('seguimentos', () => {
      it('salva, lê e atualiza o status preservando a data de criação', async () => {
        const a = await newUser('ana');
        const b = await newUser('bia');
        await h.follows.save({ followerId: a, followeeId: b, status: 'PENDING', createdAt: at(10) });
        const first = (await h.follows.get(a, b))!;
        assert.equal(first.status, 'PENDING');
        assert.equal(first.createdAt.getTime(), at(10).getTime());

        await h.follows.save({ followerId: a, followeeId: b, status: 'ACCEPTED', createdAt: at(99) });
        const second = (await h.follows.get(a, b))!;
        assert.equal(second.status, 'ACCEPTED');
        assert.equal(second.createdAt.getTime(), at(10).getTime(), 'createdAt original preservado');

        assert.equal(await h.follows.get(b, a), undefined, 'o sentido importa');
      });

      it('delete informa se removeu; deleteBetween remove os dois sentidos', async () => {
        const a = await newUser('ana');
        const b = await newUser('bia');
        const c = await newUser('caio');
        await h.follows.save({ followerId: a, followeeId: b, status: 'ACCEPTED', createdAt: at(1) });
        await h.follows.save({ followerId: b, followeeId: a, status: 'PENDING', createdAt: at(2) });
        await h.follows.save({ followerId: c, followeeId: a, status: 'ACCEPTED', createdAt: at(3) });

        assert.equal(await h.follows.delete(a, b), true);
        assert.equal(await h.follows.delete(a, b), false);

        await h.follows.save({ followerId: a, followeeId: b, status: 'ACCEPTED', createdAt: at(4) });
        await h.follows.deleteBetween(a, b);
        assert.equal(await h.follows.get(a, b), undefined);
        assert.equal(await h.follows.get(b, a), undefined);
        assert.ok(await h.follows.get(c, a), 'terceiros intactos');
      });

      it('lista seguidores e seguindo por status, mais recentes primeiro, com paginação e contagem', async () => {
        const alvo = await newUser('alvo');
        const f1 = await newUser('fa');
        const f2 = await newUser('fb');
        const f3 = await newUser('fc');
        const pend = await newUser('fd');
        await h.follows.save({ followerId: f1, followeeId: alvo, status: 'ACCEPTED', createdAt: at(1) });
        await h.follows.save({ followerId: f2, followeeId: alvo, status: 'ACCEPTED', createdAt: at(2) });
        await h.follows.save({ followerId: f3, followeeId: alvo, status: 'ACCEPTED', createdAt: at(3) });
        await h.follows.save({ followerId: pend, followeeId: alvo, status: 'PENDING', createdAt: at(4) });
        await h.follows.save({ followerId: alvo, followeeId: f1, status: 'ACCEPTED', createdAt: at(5) });

        const all = await h.follows.list(alvo, 'followers', 'ACCEPTED', { limit: 10, offset: 0 });
        assert.deepEqual(all.map((f) => f.followerId), [f3, f2, f1]);
        const page = await h.follows.list(alvo, 'followers', 'ACCEPTED', { limit: 2, offset: 1 });
        assert.deepEqual(page.map((f) => f.followerId), [f2, f1]);
        assert.deepEqual(
          (await h.follows.list(alvo, 'followers', 'PENDING', { limit: 10, offset: 0 })).map((f) => f.followerId),
          [pend],
        );
        assert.deepEqual(
          (await h.follows.list(alvo, 'following', 'ACCEPTED', { limit: 10, offset: 0 })).map((f) => f.followeeId),
          [f1],
        );

        assert.equal(await h.follows.count(alvo, 'followers', 'ACCEPTED'), 3);
        assert.equal(await h.follows.count(alvo, 'followers', 'PENDING'), 1);
        assert.equal(await h.follows.count(alvo, 'following', 'ACCEPTED'), 1);
        assert.equal(await h.follows.count(f1, 'followers', 'ACCEPTED'), 1);
      });

      it('acceptAllPending aceita só as pendentes recebidas pelo usuário e informa quantas', async () => {
        const dona = await newUser('dona');
        const outra = await newUser('outra');
        const x = await newUser('xx1');
        const y = await newUser('yy1');
        await h.follows.save({ followerId: x, followeeId: dona, status: 'PENDING', createdAt: at(1) });
        await h.follows.save({ followerId: y, followeeId: dona, status: 'PENDING', createdAt: at(2) });
        await h.follows.save({ followerId: x, followeeId: outra, status: 'PENDING', createdAt: at(3) });

        assert.equal(await h.follows.acceptAllPending(dona), 2);
        assert.equal((await h.follows.get(x, dona))!.status, 'ACCEPTED');
        assert.equal((await h.follows.get(x, outra))!.status, 'PENDING', 'pendência de outra conta não muda');
        assert.equal(await h.follows.acceptAllPending(dona), 0);
      });

      it('listFriendIds: só seguimento mútuo aceito, sem bloqueio em nenhum sentido', async () => {
        const eu = await newUser('eumesmo');
        const amigo = await newUser('amigo');
        const sentido = await newUser('sentido'); // só eu sigo
        const pendente = await newUser('pendente'); // mútuo, mas um lado pendente
        const bloqueado = await newUser('bloqueado'); // mútuo, mas bloqueado
        const bloqueador = await newUser('bloqueador'); // mútuo, mas me bloqueou

        const mutual = async (other: string, ab: 'ACCEPTED' | 'PENDING' = 'ACCEPTED', ba: 'ACCEPTED' | 'PENDING' = 'ACCEPTED') => {
          await h.follows.save({ followerId: eu, followeeId: other, status: ab, createdAt: at(1) });
          await h.follows.save({ followerId: other, followeeId: eu, status: ba, createdAt: at(2) });
        };
        await mutual(amigo);
        await h.follows.save({ followerId: eu, followeeId: sentido, status: 'ACCEPTED', createdAt: at(1) });
        await mutual(pendente, 'ACCEPTED', 'PENDING');
        await mutual(bloqueado);
        await mutual(bloqueador);
        await h.blocks.add(eu, bloqueado, at(3));
        await h.blocks.add(bloqueador, eu, at(3));

        assert.deepEqual(await h.follows.listFriendIds(eu), [amigo]);
        assert.deepEqual(await h.follows.listFriendIds(amigo), [eu], 'vale nos dois sentidos');
        assert.deepEqual(await h.follows.listFriendIds(sentido), []);
        assert.deepEqual(await h.follows.listFriendIds(bloqueado), []);
      });
    });

    // ---------- Bloqueios ----------

    describe('bloqueios', () => {
      it('add é idempotente; exists, existsEitherWay e remove se comportam', async () => {
        const a = await newUser('ana');
        const b = await newUser('bia');
        await h.blocks.add(a, b, at(1));
        await h.blocks.add(a, b, at(2));

        assert.equal(await h.blocks.exists(a, b), true);
        assert.equal(await h.blocks.exists(b, a), false);
        assert.equal(await h.blocks.existsEitherWay(a, b), true);
        assert.equal(await h.blocks.existsEitherWay(b, a), true);

        assert.equal(await h.blocks.remove(b, a), false);
        assert.equal(await h.blocks.remove(a, b), true);
        assert.equal(await h.blocks.remove(a, b), false);
        assert.equal(await h.blocks.existsEitherWay(a, b), false);
      });

      it('listBlockedBy e listRelatedIds', async () => {
        const a = await newUser('ana');
        const b = await newUser('bia');
        const c = await newUser('caio');
        const d = await newUser('dani');
        await h.blocks.add(a, b, at(1));
        await h.blocks.add(c, a, at(2));
        await h.blocks.add(a, c, at(3)); // bloqueio nos dois sentidos com c: c aparece uma vez só
        await h.blocks.add(d, b, at(4));

        assert.deepEqual((await h.blocks.listBlockedBy(a)).sort(), [b, c].sort());
        assert.deepEqual((await h.blocks.listRelatedIds(a)).sort(), [b, c].sort());
        assert.deepEqual(await h.blocks.listBlockedBy(b), []);
        assert.deepEqual((await h.blocks.listRelatedIds(b)).sort(), [a, d].sort());
      });
    });

    // ---------- Cadastros pendentes ----------

    describe('cadastros pendentes', () => {
      const sample = (email: string, over: Partial<PendingSignup> = {}): PendingSignup => ({
        email,
        username: 'ana',
        displayName: 'Ana',
        passwordHash: 'hash-senha',
        codeHash: 'hash-codigo',
        expiresAt: at(600),
        attempts: 0,
        sendCount: 1,
        lastSentAt: at(0),
        createdAt: at(0),
        ...over,
      });

      it('salva, lê, substitui por e-mail e apaga (idempotente)', async () => {
        await h.pending.save(sample('ana@exemplo.com'));
        const first = (await h.pending.find('ana@exemplo.com'))!;
        assert.deepEqual(first, sample('ana@exemplo.com'));

        await h.pending.save(sample('ana@exemplo.com', { username: 'ana.nova', sendCount: 2, codeHash: 'novo', attempts: 0 }));
        const second = (await h.pending.find('ana@exemplo.com'))!;
        assert.equal(second.username, 'ana.nova');
        assert.equal(second.sendCount, 2);
        assert.equal(second.codeHash, 'novo');

        assert.equal(await h.pending.find('outra@exemplo.com'), undefined);
        await h.pending.delete('ana@exemplo.com');
        await h.pending.delete('ana@exemplo.com');
        assert.equal(await h.pending.find('ana@exemplo.com'), undefined);
      });

      it('incrementAttempts soma 1, devolve o total e é atômico', async () => {
        assert.equal(await h.pending.incrementAttempts('ninguem@exemplo.com'), undefined);
        await h.pending.save(sample('ana@exemplo.com'));
        assert.equal(await h.pending.incrementAttempts('ana@exemplo.com'), 1);
        assert.equal(await h.pending.incrementAttempts('ana@exemplo.com'), 2);

        const results = await Promise.all(
          Array.from({ length: 10 }, () => h.pending.incrementAttempts('ana@exemplo.com')),
        );
        assert.equal((await h.pending.find('ana@exemplo.com'))!.attempts, 12, 'nenhum incremento perdido');
        assert.equal(new Set(results).size, 10, 'cada chamada recebeu um total diferente');
      });
    });
    describe('disponibilidade', () => {
      const slot = (userId: string, id: string, startMin: number, endMin: number, state: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' = 'AVAILABLE') => ({
        id,
        userId,
        startsAt: at(startMin * 60),
        endsAt: at(endMin * 60),
        state,
        createdAt: at(0),
      });
      const newId = () => randomUUID();

      it('add e listForUsers: intervalo semiaberto, ordenado, só dos usuários pedidos', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const a2 = slot(ana, newId(), 120, 180);
        const a1 = slot(ana, newId(), 0, 60, 'PARTIAL');
        const b1 = slot(bia, newId(), 0, 60, 'UNAVAILABLE');
        await h.availability.add(a2);
        await h.availability.add(a1);
        await h.availability.add(b1);

        const mine = await h.availability.listForUsers([ana], at(-3600), at(10_000 * 60));
        assert.deepEqual(mine.map((s) => s.id), [a1.id, a2.id]);
        assert.deepEqual(mine[0], a1, 'devolve exatamente o que foi gravado');

        const both = await h.availability.listForUsers([ana, bia], at(0), at(30 * 60));
        assert.deepEqual(both.map((s) => s.id).sort(), [a1.id, b1.id].sort());

        // Quem só encosta na borda não entra: [start, end) é semiaberto.
        assert.equal((await h.availability.listForUsers([ana], at(60 * 60), at(120 * 60))).length, 0);
        assert.equal((await h.availability.listForUsers([ana], at(59 * 60), at(121 * 60))).length, 2);
        assert.deepEqual(await h.availability.listForUsers([], at(0), at(1e6)), []);
      });

      it('recusa horário que se sobrepõe a outro do mesmo usuário, mas aceita encostar e outros usuários', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        await h.availability.add(slot(ana, newId(), 60, 120));
        await assert.rejects(h.availability.add(slot(ana, newId(), 90, 150)), (e: unknown) => e instanceof DomainError && e.code === 'CONFLICT');
        await assert.rejects(h.availability.add(slot(ana, newId(), 30, 61)), (e: unknown) => e instanceof DomainError && e.code === 'CONFLICT');
        await assert.rejects(h.availability.add(slot(ana, newId(), 70, 80)), (e: unknown) => e instanceof DomainError && e.code === 'CONFLICT');
        await h.availability.add(slot(ana, newId(), 120, 180)); // começa onde o outro termina
        await h.availability.add(slot(ana, newId(), 0, 60)); // termina onde o outro começa
        await h.availability.add(slot(bia, newId(), 60, 120)); // outro usuário, mesmo período
        assert.equal((await h.availability.listForUsers([ana], at(0), at(1e6))).length, 3);
      });

      it('delete só remove horário do próprio usuário', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const s = slot(ana, newId(), 0, 60);
        await h.availability.add(s);
        assert.equal(await h.availability.delete(bia, s.id), false);
        assert.equal(await h.availability.delete(ana, randomUUID()), false);
        assert.equal(await h.availability.delete(ana, 'não-é-uuid'), false);
        assert.equal((await h.availability.listForUsers([ana], at(0), at(1e6))).length, 1);
        assert.equal(await h.availability.delete(ana, s.id), true);
        assert.equal(await h.availability.delete(ana, s.id), false);
      });

      it('countActive conta só o que ainda não terminou', async () => {
        const ana = await newUser('ana');
        await h.availability.add(slot(ana, newId(), 0, 60));
        await h.availability.add(slot(ana, newId(), 100, 160));
        assert.equal(await h.availability.countActive(ana, at(0)), 2);
        assert.equal(await h.availability.countActive(ana, at(60 * 60)), 1, 'um que termina exatamente agora já acabou');
        assert.equal(await h.availability.countActive(ana, at(160 * 60)), 0);
        assert.equal(await h.availability.countActive(randomUUID(), at(0)), 0);
      });
    });
    describe('flash', () => {
      const MIN = 60;
      const session = (userId: string, startS: number, endS: number, extra: Partial<{ note: string | null }> = {}) => ({
        id: randomUUID(),
        userId,
        startsAt: at(startS),
        expiresAt: at(endS),
        endedAt: null,
        note: extra.note ?? null,
      });
      const invite = (from: string, to: string, extra: Partial<{ status: 'PENDING' | 'ACCEPTED'; expiresS: number }> = {}) => ({
        id: randomUUID(),
        fromUserId: from,
        toUserId: to,
        status: extra.status ?? ('PENDING' as const),
        createdAt: at(0),
        expiresAt: at(extra.expiresS ?? 15 * MIN),
        respondedAt: null,
        endedAt: null,
      });
      const pos = (inviteId: string, userId: string, lat: number, lng: number, whenS = 0) => ({ inviteId, userId, lat, lng, accuracyM: null, updatedAt: at(whenS) });
      const conflicts = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === 'CONFLICT');

      it('sessão: cria, acha só a ativa, expira e encerra', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const s = session(ana, 0, 60 * MIN, { note: 'chopp?' });
        await h.flash.createSession(s, at(0));
        assert.deepEqual(await h.flash.findActiveSession(ana, at(10)), s);
        assert.equal(await h.flash.findActiveSession(bia, at(10)), undefined);
        assert.equal((await h.flash.listActiveSessions([ana, bia], at(10))).length, 1);
        assert.equal(await h.flash.findActiveSession(ana, at(60 * MIN)), undefined, 'no instante de expirar já não está ativa');
        assert.deepEqual(await h.flash.listActiveSessions([], at(10)), []);
        assert.equal(await h.flash.endSession(bia, at(20)), false);
        assert.equal(await h.flash.endSession(ana, at(20)), true);
        assert.equal(await h.flash.endSession(ana, at(21)), false);
        assert.equal(await h.flash.findActiveSession(ana, at(22)), undefined);
      });

      it('sessão: só uma ativa por pessoa; depois de expirada ou encerrada pode criar outra', async () => {
        const ana = await newUser('ana');
        await h.flash.createSession(session(ana, 0, 60 * MIN), at(0));
        await conflicts(h.flash.createSession(session(ana, 10, 70 * MIN), at(10)));
        await h.flash.createSession(session(ana, 61 * MIN, 120 * MIN), at(61 * MIN)); // a primeira expirou
        await h.flash.endSession(ana, at(62 * MIN));
        await h.flash.createSession(session(ana, 63 * MIN, 120 * MIN), at(63 * MIN));
        assert.ok(await h.flash.findActiveSession(ana, at(64 * MIN)));
      });

      it('convite: cria, lê e atualiza; só um aberto por par, em qualquer sentido', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const caio = await newUser('caio');
        const i = invite(ana, bia);
        await h.flash.createInvite(i, at(0));
        assert.deepEqual(await h.flash.getInvite(i.id), i);
        assert.equal(await h.flash.getInvite(randomUUID()), undefined);
        assert.equal(await h.flash.getInvite('não-é-uuid'), undefined);
        await conflicts(h.flash.createInvite(invite(ana, bia), at(1)));
        await conflicts(h.flash.createInvite(invite(bia, ana), at(1)));
        await h.flash.createInvite(invite(ana, caio), at(1)); // outro par

        await h.flash.saveInvite({ ...i, status: 'DECLINED', respondedAt: at(5), endedAt: at(5) });
        const saved = (await h.flash.getInvite(i.id))!;
        assert.equal(saved.status, 'DECLINED');
        assert.deepEqual(saved.respondedAt, at(5));
        await h.flash.createInvite(invite(bia, ana), at(6)); // depois de fechado pode de novo
      });

      it('convite vencido não bloqueia um novo e vira EXPIRED', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const old = invite(ana, bia, { expiresS: 15 * MIN });
        await h.flash.createInvite(old, at(0));
        await h.flash.createInvite(invite(ana, bia), at(20 * MIN));
        assert.equal((await h.flash.getInvite(old.id))!.status, 'EXPIRED');
      });

      it('listOpenInvitesFor: pendentes e aceitos não vencidos, dos dois lados', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const caio = await newUser('caio');
        const a = invite(ana, bia);
        const b = invite(caio, ana, { status: 'ACCEPTED' });
        const vencido = invite(bia, caio, { expiresS: 5 * MIN });
        await h.flash.createInvite(a, at(0));
        await h.flash.createInvite(b, at(0));
        await h.flash.createInvite(vencido, at(0));
        const mine = await h.flash.listOpenInvitesFor(ana, at(10 * MIN));
        assert.deepEqual(mine.map((x) => x.id).sort(), [a.id, b.id].sort());
        assert.deepEqual((await h.flash.listOpenInvitesFor(bia, at(10 * MIN))).map((x) => x.id), [a.id], 'o vencido não aparece');
        assert.deepEqual(await h.flash.listOpenInvitesFor(randomUUID(), at(0)), []);
      });

      it('posição: guarda só a última por pessoa e some quando o convite deixa de estar aceito', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const i = invite(ana, bia, { status: 'ACCEPTED' });
        await h.flash.createInvite(i, at(0));
        await h.flash.upsertPosition(pos(i.id, ana, 1, 2, 1));
        await h.flash.upsertPosition(pos(i.id, ana, 3, 4, 2));
        await h.flash.upsertPosition(pos(i.id, bia, 5, 6, 2));
        const list = await h.flash.listPositions(i.id);
        assert.equal(list.length, 2);
        const mine = list.find((p) => p.userId === ana)!;
        assert.deepEqual([mine.lat, mine.lng], [3, 4]);
        assert.deepEqual(mine.updatedAt, at(2));
        assert.deepEqual(await h.flash.listPositions(randomUUID()), []);

        await h.flash.saveInvite({ ...i, status: 'ENDED', endedAt: at(10) });
        assert.deepEqual(await h.flash.listPositions(i.id), []);
      });

      it('closeOpenInvitesOf e closeOpenInvitesBetween: pendente vira CANCELED, aceito vira ENDED, posições somem', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const caio = await newUser('caio');
        const pending = invite(ana, bia);
        const accepted = invite(caio, ana, { status: 'ACCEPTED' });
        await h.flash.createInvite(pending, at(0));
        await h.flash.createInvite(accepted, at(0));
        await h.flash.upsertPosition(pos(accepted.id, caio, 1, 1));

        assert.equal(await h.flash.closeOpenInvitesBetween(ana, bia, at(5)), 1);
        assert.equal((await h.flash.getInvite(pending.id))!.status, 'CANCELED');
        assert.equal((await h.flash.getInvite(accepted.id))!.status, 'ACCEPTED', 'outro par não é afetado');
        assert.equal(await h.flash.closeOpenInvitesBetween(ana, bia, at(6)), 0);

        assert.equal(await h.flash.closeOpenInvitesOf(ana, at(7)), 1);
        const ended = (await h.flash.getInvite(accepted.id))!;
        assert.equal(ended.status, 'ENDED');
        assert.deepEqual(ended.endedAt, at(7));
        assert.deepEqual(await h.flash.listPositions(accepted.id), []);
        assert.equal(await h.flash.closeOpenInvitesOf(randomUUID(), at(8)), 0);
      });

      it('purgeExpired: vence convites, apaga posições órfãs e remove o que fechou há mais de 24 h', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const accepted = invite(ana, bia, { status: 'ACCEPTED', expiresS: 30 * MIN });
        await h.flash.createInvite(accepted, at(0));
        await h.flash.upsertPosition(pos(accepted.id, ana, 1, 1));
        const keep = session(ana, 0, 60 * MIN);
        await h.flash.createSession(keep, at(0));

        const first = await h.flash.purgeExpired(at(31 * MIN));
        assert.equal(first.invites, 1);
        assert.equal((await h.flash.getInvite(accepted.id))!.status, 'ENDED');
        assert.deepEqual(await h.flash.listPositions(accepted.id), []);
        assert.equal(first.removed, 0, 'nada fechado há mais de 24 h ainda');

        const later = await h.flash.purgeExpired(at(26 * 60 * MIN));
        assert.ok(later.removed >= 2, 'convite e sessão antigos saem');
        assert.equal(await h.flash.getInvite(accepted.id), undefined);
      });
    });
    describe('conversas', () => {
      const msg = (conversationId: string, senderId: string, body: string, whenS: number, extra: Partial<{ suggestion: SuggestionCard }> = {}): MessageRecord => ({
        id: randomUUID(),
        conversationId,
        senderId,
        kind: extra.suggestion ? 'SUGGESTION' : 'TEXT',
        body,
        suggestion: extra.suggestion ?? null,
        response: null,
        respondedAt: null,
        meetupId: null,
        createdAt: at(whenS),
      });
      const card: SuggestionCard = { source: 'EVENT', title: 'Jazz', venueName: 'Bar do Zé', lat: -23.55, lng: -46.63, startsAt: '2026-10-13T20:00:00.000Z', endsAt: null, sample: true, externalId: 'event:1' };

      it('getOrCreateDirect é idempotente e não depende da ordem', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const first = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        const again = await h.conversations.getOrCreateDirect(bia, ana, randomUUID(), at(5));
        assert.equal(again.id, first.id);
        assert.equal(first.directKey, [ana, bia].sort().join(':'));
        assert.deepEqual(await h.conversations.findById(first.id), first);
        assert.equal(await h.conversations.findById(randomUUID()), undefined);
        assert.equal(await h.conversations.findById('nao-e-uuid'), undefined);
        assert.deepEqual([...(await h.conversations.participantIds(first.id))!].sort(), [ana, bia].sort());
        assert.equal(await h.conversations.participantIds(randomUUID()), undefined);
        const cia = await newUser('cia');
        const other = await h.conversations.getOrCreateDirect(ana, cia, randomUUID(), at(6));
        assert.notEqual(other.id, first.id);
      });

      it('mensagens: ordem cronológica, limite e paginação para trás', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const c = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        for (let i = 1; i <= 5; i++) await h.conversations.addMessage(msg(c.id, i % 2 ? ana : bia, `m${i}`, i));
        assert.deepEqual((await h.conversations.listMessages(c.id, 3)).map((m) => m.body), ['m3', 'm4', 'm5']);
        assert.deepEqual((await h.conversations.listMessages(c.id, 10, at(3))).map((m) => m.body), ['m1', 'm2']);
        assert.deepEqual(await h.conversations.listMessages(randomUUID(), 10), []);
      });

      it('guarda o cartão de sugestão e devolve igual', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const c = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        const m = msg(c.id, ana, 'Jazz — Bar do Zé', 1, { suggestion: card });
        await h.conversations.addMessage(m);
        await h.conversations.addMessage(msg(c.id, bia, 'oi', 2));
        const [got, text] = await h.conversations.listMessages(c.id, 10);
        assert.equal(got!.kind, 'SUGGESTION');
        assert.deepEqual(got!.suggestion, card);
        assert.equal(text!.kind, 'TEXT');
        assert.equal(text!.suggestion, null);
      });

      it('listForUser: última mensagem, não lidas e ordem; markRead zera só para quem leu', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const cia = await newUser('cia');
        const c1 = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        const c2 = await h.conversations.getOrCreateDirect(ana, cia, randomUUID(), at(1));
        await h.conversations.addMessage(msg(c1.id, bia, 'a', 10));
        await h.conversations.addMessage(msg(c1.id, bia, 'b', 11));
        await h.conversations.addMessage(msg(c1.id, ana, 'c', 12));
        const list = await h.conversations.listForUser(ana);
        assert.deepEqual(list.map((s) => s.conversation.id), [c1.id, c2.id], 'mais recente primeiro; sem mensagens usa a criação');
        assert.equal(list[0]!.lastMessage!.body, 'c');
        assert.equal(list[0]!.unread, 2);
        assert.equal(list[1]!.lastMessage, null);
        assert.equal((await h.conversations.listForUser(bia))[0]!.unread, 1, 'só o que a outra pessoa enviou conta');
        await h.conversations.markRead(c1.id, ana, at(20));
        assert.equal((await h.conversations.listForUser(ana))[0]!.unread, 0);
        assert.equal((await h.conversations.listForUser(bia))[0]!.unread, 1);
        await h.conversations.addMessage(msg(c1.id, bia, 'd', 21));
        assert.equal((await h.conversations.listForUser(ana))[0]!.unread, 1);
        assert.deepEqual(await h.conversations.listForUser(randomUUID()), []);
      });

      it('findMessage e setSuggestionResponse: grava uma resposta só, e só em cartão', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const c = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        const card1 = msg(c.id, ana, 'Jazz — Bar do Zé', 1, { suggestion: card });
        const text = msg(c.id, ana, 'oi', 2);
        await h.conversations.addMessage(card1);
        await h.conversations.addMessage(text);
        assert.deepEqual(await h.conversations.findMessage(card1.id), card1);
        assert.equal(await h.conversations.findMessage(randomUUID()), undefined);
        assert.equal(await h.conversations.findMessage('nao-e-uuid'), undefined);
        assert.equal(await h.conversations.setSuggestionResponse(text.id, 'ACCEPTED', at(5)), false, 'texto não tem resposta');
        assert.equal(await h.conversations.setSuggestionResponse(randomUUID(), 'ACCEPTED', at(5)), false);
        assert.equal(await h.conversations.setSuggestionResponse(card1.id, 'ACCEPTED', at(5)), true);
        assert.equal(await h.conversations.setSuggestionResponse(card1.id, 'DECLINED', at(6)), false, 'a primeira resposta vale');
        const saved = (await h.conversations.findMessage(card1.id))!;
        assert.equal(saved.response, 'ACCEPTED');
        assert.deepEqual(saved.respondedAt, at(5));
        assert.equal((await h.conversations.findMessage(text.id))!.response, null);
      });

      it('countSentSince conta só as mensagens do remetente dentro da janela', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const c = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        await h.conversations.addMessage(msg(c.id, ana, 'x', 10));
        await h.conversations.addMessage(msg(c.id, ana, 'y', 50));
        await h.conversations.addMessage(msg(c.id, bia, 'z', 51));
        assert.equal(await h.conversations.countSentSince(ana, at(0)), 2);
        assert.equal(await h.conversations.countSentSince(ana, at(11)), 1);
        assert.equal(await h.conversations.countSentSince(bia, at(0)), 1);
      });
    });

    describe('lugares e eventos', () => {
      const venue = (name: string, lat: number, lng: number, isSample = false): VenueRecord => ({ id: randomUUID(), name, address: null, category: 'bar', lat, lng, isSample });
      const event = (venueId: string, title: string, startS: number, endS: number): PlaceEventRecord => ({ id: randomUUID(), venueId, title, description: null, kind: 'OTHER', isFree: false, imageUrl: null, tags: [], startsAt: at(startS), endsAt: at(endS), isSample: true });
      const centre = { lat: -23.5505, lng: -46.6333 };
      const H = 3600;

      it('filtra por raio exato, por janela de tempo e ordena do mais perto', async () => {
        const near = venue('Perto', -23.5515, -46.6333, true); // ~111 m
        const mid = venue('Médio', -23.5605, -46.6333); // ~1,1 km
        const far = venue('Longe', -23.5905, -46.6333); // ~4,5 km
        for (const v of [near, mid, far]) await h.places.createVenue(v);
        const eNear = event(near.id, 'A', 1 * H, 3 * H);
        const eMid = event(mid.id, 'B', 2 * H, 4 * H);
        const eFar = event(far.id, 'C', 1 * H, 3 * H);
        const eLate = event(near.id, 'Tarde', 30 * H, 32 * H);
        const eOver = event(near.id, 'Acabou', -5 * H, -4 * H);
        const eNow = event(mid.id, 'Em andamento', -1 * H, 1 * H);
        for (const e of [eMid, eFar, eNear, eLate, eOver, eNow]) await h.places.createEvent(e);

        const got = await h.places.findEventsNear(centre, 3000, at(0), at(12 * H), 10);
        assert.deepEqual(got.map((r) => r.event.title), ['A', 'Em andamento', 'B']);
        assert.equal(got[0]!.venue.name, 'Perto');
        assert.equal(got[0]!.venue.isSample, true);
        assert.deepEqual(got[0]!.event.startsAt, at(1 * H));
        assert.deepEqual((await h.places.findEventsNear(centre, 3000, at(0), at(12 * H), 1)).map((r) => r.event.title), ['A']);
        assert.deepEqual((await h.places.findEventsNear(centre, 200, at(0), at(12 * H), 10)).map((r) => r.event.title), ['A']);
        assert.deepEqual(await h.places.findEventsNear({ lat: 40, lng: 40 }, 3000, at(0), at(12 * H), 10), []);
      });

      it('evento que termina exatamente em `from` ou começa em `to` fica de fora', async () => {
        const v = venue('V', centre.lat, centre.lng);
        await h.places.createVenue(v);
        await h.places.createEvent(event(v.id, 'terminou', -2 * H, 0));
        await h.places.createEvent(event(v.id, 'comeca-no-fim', 12 * H, 13 * H));
        assert.deepEqual(await h.places.findEventsNear(centre, 1000, at(0), at(12 * H), 10), []);
      });

      it('searchEvents: tipo, grátis, hashtag, texto sem acento, raio opcional e ordem por horário', async () => {
        const bar = venue('Bar do Zé', -23.5515, -46.6333);
        const far = venue('Casa Distante', -23.6505, -46.6333); // ~11 km
        await h.places.createVenue(bar);
        await h.places.createVenue(far);
        const mk = (v: VenueRecord, title: string, startS: number, over: Partial<PlaceEventRecord>) => ({ ...event(v.id, title, startS, startS + 2 * H), ...over });
        await h.places.createEvent(mk(bar, 'Samba de Raiz', 3 * H, { kind: 'SHOW', isFree: true, tags: ['samba', 'sambarock'] }));
        await h.places.createEvent(mk(bar, 'Cinema ao Ar Livre', 1 * H, { kind: 'CINEMA', tags: ['filme'] }));
        await h.places.createEvent(mk(far, 'Exposição Fotográfica', 2 * H, { kind: 'EXHIBITION', isFree: true }));
        const q = (over: object) => ({ from: at(0), to: at(24 * H), limit: 20, ...over });
        const titles = async (over: object) => (await h.places.searchEvents(q(over))).map((r) => r.event.title);
        assert.deepEqual(await titles({}), ['Cinema ao Ar Livre', 'Exposição Fotográfica', 'Samba de Raiz']);
        assert.deepEqual(await titles({ kind: 'SHOW' }), ['Samba de Raiz']);
        assert.deepEqual(await titles({ freeOnly: true }), ['Exposição Fotográfica', 'Samba de Raiz']);
        assert.deepEqual(await titles({ tagPrefix: 'samb' }), ['Samba de Raiz']);
        assert.deepEqual(await titles({ text: 'exposicao' }), ['Exposição Fotográfica']);
        assert.deepEqual(await titles({ text: 'ze' }), ['Cinema ao Ar Livre', 'Samba de Raiz']);
        assert.deepEqual(await titles({ center: centre, radiusM: 3000 }), ['Cinema ao Ar Livre', 'Samba de Raiz']);
        const withDistance = await h.places.searchEvents(q({ center: centre, radiusM: 50000, limit: 1 }));
        assert.equal(withDistance.length, 1);
        assert.ok((withDistance[0]!.distanceM ?? 0) > 100);
        assert.equal((await h.places.searchEvents(q({}))).every((r) => r.distanceM === null), true);
        assert.deepEqual(await titles({ from: at(10 * H), to: at(20 * H) }), []);
        const first = (await h.places.searchEvents(q({ kind: 'SHOW' })))[0]!;
        assert.deepEqual(first.event.tags, ['samba', 'sambarock']);
        assert.equal((await h.places.findEvent(first.event.id))?.venue.name, 'Bar do Zé');
        assert.equal(await h.places.findEvent('nao-existe'), undefined);
      });

      it('listTags conta por prefixo só de eventos ativos e searchVenues acha por nome', async () => {
        const a = venue('Bar Alfa', -23.5515, -46.6333);
        const b = venue('Boteco Beta', -23.7505, -46.6333); // ~22 km
        await h.places.createVenue(a);
        await h.places.createVenue(b);
        await h.places.createEvent({ ...event(a.id, 'x', 1 * H, 2 * H), tags: ['samba', 'rock'] });
        await h.places.createEvent({ ...event(b.id, 'y', 1 * H, 2 * H), tags: ['samba'] });
        await h.places.createEvent({ ...event(a.id, 'velho', -9 * H, -8 * H), tags: ['samba'] });
        assert.deepEqual(await h.places.listTags('sa', at(0), at(24 * H), 10), [{ tag: 'samba', count: 2 }]);
        assert.deepEqual(await h.places.listTags('', at(0), at(24 * H), 10), [{ tag: 'samba', count: 2 }, { tag: 'rock', count: 1 }]);
        assert.deepEqual((await h.places.searchVenues('BAR', undefined, 0, 10)).map((r) => r.venue.name), ['Bar Alfa']);
        assert.deepEqual((await h.places.searchVenues('bot', centre, 5000, 10)).map((r) => r.venue.name), []);
        assert.deepEqual((await h.places.searchVenues('bot', centre, 30000, 10)).map((r) => r.venue.name), ['Boteco Beta']);
      });
    });

    describe('grupos e encontros', () => {
      const H = 3600;
      const setup = async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const caio = await newUser('caio');
        const v: VenueRecord = { id: randomUUID(), name: 'Parque', address: null, category: 'park', lat: -23.58, lng: -46.65, isSample: true };
        await h.places.createVenue(v);
        const e: PlaceEventRecord = { id: randomUUID(), venueId: v.id, title: 'Piquenique', description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: at(2 * H), endsAt: at(5 * H), isSample: true };
        await h.places.createEvent(e);
        return { ana, bia, caio, e };
      };
      const meetup = (organizerId: string, conversationId: string, eventId: string, guests: string[]): MeetupRecord => ({
        id: randomUUID(), organizerId, conversationId, eventId, title: 'Piquenique', startsAt: at(2 * H), endsAt: at(5 * H), status: 'ACTIVE', createdAt: at(0),
        participants: [{ userId: organizerId, status: 'CONFIRMED', respondedAt: at(0) }, ...guests.map((userId) => ({ userId, status: 'INVITED' as const, respondedAt: null }))],
      });

      it('grupo começa só com quem organiza e cada aceite entra (sem repetir)', async () => {
        const { ana, bia, caio } = await setup();
        const g = await h.conversations.createGroup({ id: randomUUID(), name: 'Grupo da fofoca', ownerId: ana, now: at(1) });
        assert.equal(g.type, 'GROUP');
        assert.equal(g.name, 'Grupo da fofoca');
        assert.equal(g.ownerId, ana);
        assert.equal(g.directKey, null);
        assert.deepEqual(await h.conversations.participantIds(g.id), [ana]);
        await h.conversations.addParticipant(g.id, bia, at(2));
        await h.conversations.addParticipant(g.id, bia, at(3));
        assert.deepEqual([...(await h.conversations.participantIds(g.id))!].sort(), [ana, bia].sort());
        assert.deepEqual(await h.conversations.findById(g.id), g);
        assert.equal((await h.conversations.listForUser(caio)).length, 0);
        const mine = await h.conversations.listForUser(bia);
        assert.equal(mine.length, 1);
        assert.equal(mine[0]!.conversation.name, 'Grupo da fofoca');
        assert.equal(mine[0]!.participantIds.length, 2);
        await h.conversations.addMessage({ id: randomUUID(), conversationId: g.id, senderId: ana, kind: 'TEXT', body: 'oi grupo', suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: at(4) });
        assert.equal((await h.conversations.listForUser(bia))[0]!.unread, 1);
      });

      it('encontro: criar, ler, responder uma vez, contar e listar por conversa', async () => {
        const { ana, bia, caio, e } = await setup();
        const g = await h.conversations.createGroup({ id: randomUUID(), name: 'G', ownerId: ana, now: at(1) });
        const m = meetup(ana, g.id, e.id, [bia, caio]);
        await h.meetups.create(m);
        const found = (await h.meetups.find(m.id))!;
        assert.equal(found.organizerId, ana);
        assert.equal(found.eventId, e.id);
        assert.deepEqual(found.startsAt, at(2 * H));
        assert.deepEqual(found.participants.map((p) => [p.userId, p.status]).sort(), [[ana, 'CONFIRMED'], [bia, 'INVITED'], [caio, 'INVITED']].sort());
        assert.equal(await h.meetups.find(randomUUID()), undefined);
        assert.equal(await h.meetups.find('nao-e-uuid'), undefined);
        assert.equal(await h.meetups.respond(m.id, bia, 'CONFIRMED', at(10)), true);
        assert.equal(await h.meetups.respond(m.id, bia, 'DECLINED', at(11)), false, 'só uma resposta');
        assert.equal(await h.meetups.respond(m.id, ana, 'DECLINED', at(11)), false, 'quem organiza não responde');
        assert.equal(await h.meetups.respond(m.id, randomUUID(), 'CONFIRMED', at(11)), false);
        assert.equal(await h.meetups.respond(m.id, caio, 'DECLINED', at(12)), true);
        const after = (await h.meetups.find(m.id))!;
        assert.equal(after.participants.find((p) => p.userId === bia)!.status, 'CONFIRMED');
        assert.deepEqual(after.participants.find((p) => p.userId === bia)!.respondedAt, at(10));
        assert.equal(after.participants.find((p) => p.userId === caio)!.status, 'DECLINED');
        assert.deepEqual((await h.meetups.listForConversation(g.id)).map((x) => x.id), [m.id]);
        assert.deepEqual(await h.meetups.listForConversation(randomUUID()), []);
        assert.equal(await h.meetups.countCreatedSince(ana, at(0)), 1);
        assert.equal(await h.meetups.countCreatedSince(ana, at(5)), 0);
        assert.equal(await h.meetups.countCreatedSince(bia, at(0)), 0);
      });

      it('mensagem de encontro guarda o id e volta na leitura', async () => {
        const { ana, bia, e } = await setup();
        const c = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(0));
        const m = meetup(ana, c.id, e.id, [bia]);
        await h.meetups.create(m);
        await h.conversations.addMessage({ id: randomUUID(), conversationId: c.id, senderId: ana, kind: 'MEETUP', body: 'Encontro: Piquenique', suggestion: null, response: null, respondedAt: null, meetupId: m.id, createdAt: at(1) });
        const [got] = await h.conversations.listMessages(c.id, 10);
        assert.equal(got!.kind, 'MEETUP');
        assert.equal(got!.meetupId, m.id);
        assert.equal(got!.suggestion, null);
      });

      it('gestão do grupo: remover, mudar nome/foto/dono, ordem de entrada e mensagens sem certos remetentes', async () => {
        const { ana, bia, caio } = await setup();
        const g = await h.conversations.createGroup({ id: randomUUID(), name: 'G', ownerId: ana, now: at(1) });
        await h.conversations.addParticipant(g.id, caio, at(2));
        await h.conversations.addParticipant(g.id, bia, at(3));
        assert.deepEqual(await h.conversations.participantIds(g.id), [ana, caio, bia], 'ordem de entrada');
        await h.conversations.updateGroup(g.id, { name: 'Novo', imageUrl: 'data:image/jpeg;base64,/9j/4A==', ownerId: caio });
        const got = (await h.conversations.findById(g.id))!;
        assert.equal(got.name, 'Novo');
        assert.equal(got.imageUrl, 'data:image/jpeg;base64,/9j/4A==');
        assert.equal(got.ownerId, caio);
        await h.conversations.updateGroup(g.id, { imageUrl: null });
        assert.equal((await h.conversations.findById(g.id))!.imageUrl, null);
        const msg = (senderId: string, body: string, s: number): MessageRecord => ({ id: randomUUID(), conversationId: g.id, senderId, kind: 'TEXT', body, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: at(s) });
        await h.conversations.addMessage(msg(ana, 'a', 10));
        await h.conversations.addMessage(msg(caio, 'c', 11));
        await h.conversations.addMessage({ ...msg(caio, 'Caio saiu', 12), kind: 'SYSTEM' });
        assert.deepEqual((await h.conversations.listMessages(g.id, 10)).map((m) => m.body), ['a', 'c', 'Caio saiu']);
        assert.deepEqual((await h.conversations.listMessages(g.id, 10, undefined, [caio])).map((m) => m.body), ['a']);
        const summary = (await h.conversations.listForUser(bia, [caio])).find((x) => x.conversation.id === g.id)!;
        assert.equal(summary.lastMessage?.body, 'a');
        assert.equal(summary.unread, 1);
        assert.equal((await h.conversations.listForUser(bia)).find((x) => x.conversation.id === g.id)!.unread, 3);
        await h.conversations.removeParticipant(g.id, caio);
        await h.conversations.removeParticipant(g.id, caio);
        assert.deepEqual(await h.conversations.participantIds(g.id), [ana, bia]);
        assert.equal((await h.conversations.listForUser(caio)).length, 0);
      });

      it('encontro: convidar de novo, mudar título/estado e sair dos encontros do grupo', async () => {
        const { ana, bia, caio, e } = await setup();
        const g = await h.conversations.createGroup({ id: randomUUID(), name: 'G', ownerId: ana, now: at(1) });
        const m = meetup(ana, g.id, e.id, [bia]);
        await h.meetups.create(m);
        await h.meetups.respond(m.id, bia, 'CONFIRMED', at(5));
        assert.deepEqual(await h.meetups.invite(m.id, [bia, caio]), [caio], 'quem já confirmou fica como está');
        await h.meetups.respond(m.id, caio, 'DECLINED', at(6));
        assert.deepEqual(await h.meetups.invite(m.id, [caio]), [caio], 'quem recusou volta a ser convidado');
        assert.equal((await h.meetups.find(m.id))!.participants.find((p) => p.userId === caio)!.status, 'INVITED');
        await h.meetups.update(m.id, { title: 'Outro nome', status: 'CANCELLED' });
        const after = (await h.meetups.find(m.id))!;
        assert.equal(after.title, 'Outro nome');
        assert.equal(after.status, 'CANCELLED');
        await h.meetups.update(m.id, { status: 'ACTIVE' });
        assert.equal((await h.meetups.find(m.id))!.status, 'ACTIVE');
        await h.meetups.declineAllFor(g.id, bia, at(8));
        await h.meetups.declineAllFor(g.id, ana, at(8));
        const final = (await h.meetups.find(m.id))!;
        assert.equal(final.participants.find((p) => p.userId === bia)!.status, 'DECLINED');
        assert.equal(final.participants.find((p) => p.userId === ana)!.status, 'CONFIRMED', 'quem organiza continua');
        assert.equal(final.participants.find((p) => p.userId === caio)!.status, 'INVITED');
      });

      it('avisos: criar, listar do mais novo ao mais antigo, contar, juntar por chave e marcar como lido', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const n = (id: string, userId: string, s: number, dedupeKey: string | null = null) => ({ id, userId, type: 'MESSAGE' as const, title: 'T' + id.slice(-1), body: 'B', url: '/conversas', dedupeKey, readAt: null, createdAt: at(s) });
        const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];
        await h.notifications.create(n(ids[0]!, ana, 1, 'k1'));
        await h.notifications.create(n(ids[1]!, ana, 2));
        await h.notifications.create(n(ids[2]!, ana, 3, 'k2'));
        await h.notifications.create(n(ids[3]!, bia, 4, 'k1'));
        assert.deepEqual((await h.notifications.listForUser(ana, 10)).map((x) => x.id), [ids[2], ids[1], ids[0]]);
        assert.equal((await h.notifications.listForUser(ana, 2)).length, 2);
        assert.equal((await h.notifications.listForUser(ana, 10))[0]!.dedupeKey, 'k2');
        assert.equal(await h.notifications.unreadCount(ana), 3);
        assert.equal(await h.notifications.hasUnread(ana, 'k1'), true);
        assert.equal(await h.notifications.hasUnread(ana, 'k9'), false);
        assert.equal(await h.notifications.markRead(ana, at(10), [ids[0]!, ids[3]!]), 1, 'só marca o que é da pessoa');
        assert.equal(await h.notifications.hasUnread(ana, 'k1'), false, 'lido não segura novos avisos');
        assert.equal(await h.notifications.hasUnread(bia, 'k1'), true);
        assert.equal((await h.notifications.listForUser(ana, 10)).find((x) => x.id === ids[0])!.readAt?.getTime(), at(10).getTime());
        assert.equal(await h.notifications.markRead(ana, at(11)), 2);
        assert.equal(await h.notifications.unreadCount(ana), 0);
        assert.equal(await h.notifications.markRead(ana, at(12)), 0);
      });

      it('inscrições de push: uma por endpoint, troca de dono, remoção por dono', async () => {
        const ana = await newUser('ana');
        const bia = await newUser('bia');
        const sub = (userId: string, endpoint: string, s: number) => ({ userId, endpoint, p256dh: 'pk', auth: 'au', createdAt: at(s) });
        await h.pushSubscriptions.upsert(sub(ana, 'https://p/1', 1));
        await h.pushSubscriptions.upsert(sub(ana, 'https://p/2', 2));
        await h.pushSubscriptions.upsert({ ...sub(ana, 'https://p/1', 9), p256dh: 'novo' });
        const list = await h.pushSubscriptions.listForUser(ana);
        assert.deepEqual(list.map((x) => x.endpoint), ['https://p/1', 'https://p/2']);
        assert.equal(list[0]!.p256dh, 'novo');
        await h.pushSubscriptions.upsert(sub(bia, 'https://p/1', 10));
        assert.deepEqual((await h.pushSubscriptions.listForUser(ana)).map((x) => x.endpoint), ['https://p/2'], 'o aparelho passa para quem entrou por último');
        await h.pushSubscriptions.remove('https://p/1', ana);
        assert.equal((await h.pushSubscriptions.listForUser(bia)).length, 1, 'outra pessoa não remove');
        await h.pushSubscriptions.remove('https://p/1', bia);
        assert.equal((await h.pushSubscriptions.listForUser(bia)).length, 0);
        await h.pushSubscriptions.remove('https://p/2');
        assert.equal((await h.pushSubscriptions.listForUser(ana)).length, 0);
      });

      it('perfil: foto guardada, trocada e removida; eventos postados com contagem e paginação', async () => {
        const { ana, bia, e } = await setup();
        assert.equal(await h.users.findPhoto(ana), undefined);
        await h.users.setPhoto(ana, { mime: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), updatedAt: at(1) });
        const got = (await h.users.findPhoto(ana))!;
        assert.equal(got.mime, 'image/jpeg');
        assert.deepEqual([...got.data], [0xff, 0xd8, 0xff, 1, 2, 3]);
        await h.users.setPhoto(ana, { mime: 'image/png', data: new Uint8Array([9, 9]), updatedAt: at(2) });
        assert.equal((await h.users.findPhoto(ana))!.mime, 'image/png');
        assert.equal(await h.users.findPhoto(bia), undefined, 'foto é de cada pessoa');
        await h.users.setPhoto(ana, null);
        assert.equal(await h.users.findPhoto(ana), undefined);
        await h.users.setPhoto(ana, null);

        const e2: PlaceEventRecord = { ...e, id: randomUUID(), title: 'Outro' };
        const e3: PlaceEventRecord = { ...e, id: randomUUID(), title: 'Mais um' };
        await h.places.createEvent(e2);
        await h.places.createEvent(e3);
        assert.equal(await h.profileEvents.add(ana, e.id, at(10)), true);
        assert.equal(await h.profileEvents.add(ana, e.id, at(11)), false, 'já postado');
        await h.profileEvents.add(ana, e2.id, at(12));
        await h.profileEvents.add(ana, e3.id, at(13));
        await h.profileEvents.add(bia, e.id, at(14));
        assert.equal(await h.profileEvents.count(ana), 3);
        assert.equal(await h.profileEvents.has(ana, e.id), true);
        assert.equal(await h.profileEvents.has(bia, e2.id), false);
        assert.deepEqual((await h.profileEvents.list(ana, { limit: 10, offset: 0 })).map((r) => r.eventId), [e3.id, e2.id, e.id], 'mais recente primeiro');
        assert.deepEqual((await h.profileEvents.list(ana, { limit: 1, offset: 1 })).map((r) => r.eventId), [e2.id]);
        assert.equal(await h.profileEvents.remove(ana, e2.id), true);
        assert.equal(await h.profileEvents.remove(ana, e2.id), false);
        assert.equal(await h.profileEvents.count(ana), 2);
      });

      it('mensagem de evento guarda o evento; encontros do usuário listados do mais recente', async () => {
        const { ana, bia, caio, e } = await setup();
        const conv = await h.conversations.getOrCreateDirect(ana, bia, randomUUID(), at(1));
        const m: MessageRecord = { id: randomUUID(), conversationId: conv.id, senderId: ana, kind: 'EVENT', body: 'Evento: Piquenique', suggestion: null, response: null, respondedAt: null, meetupId: null, eventId: e.id, createdAt: at(2) };
        await h.conversations.addMessage(m);
        const back = (await h.conversations.listMessages(conv.id, 10))[0]!;
        assert.equal(back.kind, 'EVENT');
        assert.equal(back.eventId, e.id);
        const text = (await h.conversations.listMessages(conv.id, 10)).length;
        assert.equal(text, 1);

        const g = await h.conversations.createGroup({ id: randomUUID(), name: 'G', ownerId: ana, now: at(1) });
        const m1 = { ...meetup(ana, g.id, e.id, [bia]), id: randomUUID(), startsAt: at(5 * H), endsAt: at(6 * H) };
        const m2 = { ...meetup(bia, conv.id, e.id, [ana]), id: randomUUID(), startsAt: at(8 * H), endsAt: at(9 * H) };
        await h.meetups.create(m1);
        await h.meetups.create(m2);
        assert.deepEqual((await h.meetups.listForUser(ana, 10)).map((x) => x.id), [m2.id, m1.id]);
        assert.deepEqual((await h.meetups.listForUser(bia, 1)).map((x) => x.id), [m2.id]);
        assert.deepEqual(await h.meetups.listForUser(caio, 10), []);
      });
    });
  });
}
