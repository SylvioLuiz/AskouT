import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DomainError } from '../errors.ts';
import type { AvailabilityRepository, FlashRepository, BlockRepository, FollowRepository, PendingSignupRepository, UserRepository } from '../ports.ts';
import type { PendingSignup, Profile, User, UserStatus } from '../types.ts';

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
  });
}
