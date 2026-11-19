import { eventRefId } from './album.ts';
import type { AlbumRecord } from './album.ts';
import { DEFAULT_TIME_ZONE } from './availability-service.ts';
import { notFound, validationError } from './errors.ts';
import { decodeImageDataUrl } from './image.ts';
import type { CoreDeps } from './ports.ts';
import { POST_IMAGE_MAX_BYTES } from './post-service.ts';
import type { PostService, PostView } from './post-service.ts';
import type { EventRef, FlashInviteRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

/** Os álbuns ficam na lista por este tempo depois que o encontro começou. */
export const ALBUM_LIST_DAYS = 30;
/** Cada pessoa põe até tantas fotos num álbum. */
export const ALBUM_PHOTOS_PER_USER = 30;
/** O aviso do dia seguinte sai a partir desta hora (no fuso de São Paulo). */
export const ALBUM_SUMMARY_HOUR = 10;
/** Só olha eventos e álbuns que começaram nas últimas horas: depois disso o aviso perde a graça. */
const RECENT_HOURS = 48;
const BATCH = 200;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface AlbumSummaryView {
  id: string;
  kind: 'FLASH' | 'EVENT';
  title: string | null;
  placeName: string | null;
  startedAt: string;
  /** Quem foi, sem contar quem tem bloqueio com você nem você. */
  friendCount: number;
  photoCount: number;
  /** Primeira foto, para a capa. */
  coverPhotoId: string | null;
}

export interface AlbumPhotoView {
  id: string;
  author: PublicProfile;
  createdAt: string;
  mine: boolean;
}

export interface AlbumView extends AlbumSummaryView {
  /** Quem foi (você incluído), sem quem tem bloqueio com você. */
  members: PublicProfile[];
  photos: AlbumPhotoView[];
}

/** Data (AAAA-MM-DD) e hora local no fuso do app. */
function localParts(date: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** O NOW ganha álbum quando o encontro começa (convite aceito). Chamado pelo aceite do convite. */
export async function openFlashAlbum(deps: CoreDeps, invite: FlashInviteRecord, startedAt: Date): Promise<void> {
  const { albums, ids, clock } = deps;
  const album = await albums.ensure({ id: ids.next(), kind: 'FLASH', refId: invite.id, title: null, placeName: invite.destination?.name ?? null, startedAt, createdAt: clock.now() });
  await albums.addMembers(album.id, [invite.fromUserId, invite.toUserId], clock.now());
}

/** Álbum do encontro: fotos só de quem foi (no NOW, quem participou; no evento, quem confirmou presença). */
export class AlbumService {
  private readonly deps: CoreDeps;
  private readonly posts: PostService;

  constructor(deps: CoreDeps, posts: PostService) {
    this.deps = deps;
    this.posts = posts;
  }

  /** Álbuns do visitante: os dos últimos 30 dias, o mais recente primeiro. */
  async list(viewerId: string): Promise<AlbumSummaryView[]> {
    const { albums, clock } = this.deps;
    const since = new Date(clock.now().getTime() - ALBUM_LIST_DAYS * DAY);
    const rows = (await albums.listForUser(viewerId, since, 100)).filter((a) => a.startedAt <= clock.now());
    const blocked = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const out: AlbumSummaryView[] = [];
    for (const album of rows) out.push(await this.summary(album, viewerId, blocked));
    return out;
  }

  async get(viewerId: string, albumId: string): Promise<AlbumView> {
    const album = await this.memberAlbum(viewerId, albumId);
    const blocked = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const memberIds = (await this.deps.albums.listMembers(album.id)).filter((id) => id === viewerId || !blocked.has(id));
    const profiles = await this.deps.users.findProfilesByIds(memberIds);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const photos = (await this.deps.albums.listPhotos(album.id)).filter((p) => !blocked.has(p.authorId) && byId.has(p.authorId));
    return {
      ...(await this.summary(album, viewerId, blocked)),
      members: memberIds.flatMap((id) => byId.get(id) ?? []),
      photos: photos.map((p) => ({ id: p.id, author: byId.get(p.authorId) as PublicProfile, createdAt: p.createdAt.toISOString(), mine: p.authorId === viewerId })),
    };
  }

  /** Foto do álbum (já reduzida pelo app, até 100 KB, como no post). */
  async addPhoto(viewerId: string, albumId: string, image: unknown): Promise<AlbumPhotoView> {
    const album = await this.memberAlbum(viewerId, albumId);
    const { albums, ids, clock } = this.deps;
    const decoded = decodeImageDataUrl(image, POST_IMAGE_MAX_BYTES, '100 KB');
    if ((await albums.countPhotos(album.id, viewerId)) >= ALBUM_PHOTOS_PER_USER) {
      throw validationError('Álbum cheio', { image: `Cada pessoa pode enviar até ${ALBUM_PHOTOS_PER_USER} fotos por álbum` });
    }
    const photo = { id: ids.next(), albumId: album.id, authorId: viewerId, mime: decoded.mime, data: new Uint8Array(decoded.bytes), createdAt: clock.now() };
    await albums.addPhoto(photo);
    const me = (await this.deps.users.findProfilesByIds([viewerId]))[0];
    if (!me) throw notFound('Álbum não encontrado');
    return { id: photo.id, author: toPublicProfile(me), createdAt: photo.createdAt.toISOString(), mine: true };
  }

  /** Bytes da foto. Quem tem bloqueio com o autor não vê. */
  async photoMedia(viewerId: string, albumId: string, photoId: string): Promise<{ mime: string; data: Uint8Array }> {
    const album = await this.memberAlbum(viewerId, albumId);
    const photo = await this.deps.albums.findPhoto(album.id, typeof photoId === 'string' ? photoId : '');
    if (!photo || (photo.authorId !== viewerId && (await this.deps.blocks.existsEitherWay(viewerId, photo.authorId)))) throw notFound('Foto não encontrada');
    return { mime: photo.mime, data: photo.data };
  }

  /** Só quem enviou apaga. */
  async deletePhoto(viewerId: string, albumId: string, photoId: string): Promise<void> {
    const album = await this.memberAlbum(viewerId, albumId);
    if (!(await this.deps.albums.deletePhoto(album.id, typeof photoId === 'string' ? photoId : '', viewerId))) throw notFound('Foto não encontrada');
  }

  /** Publica no perfil de quem pede uma foto que a própria pessoa enviou ao álbum. */
  async postToProfile(viewerId: string, albumId: string, photoId: string, caption: unknown): Promise<PostView> {
    const album = await this.memberAlbum(viewerId, albumId);
    const photo = await this.deps.albums.findPhoto(album.id, typeof photoId === 'string' ? photoId : '');
    if (!photo || photo.authorId !== viewerId) throw notFound('Foto não encontrada');
    const dataUrl = `data:${photo.mime};base64,${Buffer.from(photo.data).toString('base64')}`;
    return this.posts.create(viewerId, { caption, images: [dataUrl], ...(album.placeName ? { placeName: album.placeName } : {}) });
  }

  /**
   * Abre o álbum dos eventos que começaram nas últimas 48 h e põe nele quem confirmou presença (e o dono de evento de pessoa).
   * Quem confirma depois que o evento começou também entra. Roda num job; devolve quantos álbuns tocou.
   */
  async syncEvents(): Promise<number> {
    const { places, posts, eventRoom, albums, ids, clock } = this.deps;
    const now = clock.now();
    const from = new Date(now.getTime() - RECENT_HOURS * HOUR);
    const events: { ref: EventRef; title: string; startsAt: Date; where: string | null; ownerId: string | null }[] = [];
    for (const { event, venue } of await places.searchEvents({ from, to: now, limit: BATCH })) {
      if (event.startsAt > from && event.startsAt <= now) events.push({ ref: { source: 'PLACE', id: event.id }, title: event.title, startsAt: event.startsAt, where: venue.name, ownerId: null });
    }
    for (const { post } of await posts.listEventsStartingBetween(from, now, BATCH)) {
      if (post.eventTitle === null || post.eventStartsAt === null || post.eventStartsAt <= from) continue;
      events.push({ ref: { source: 'USER', id: post.id }, title: post.eventTitle, startsAt: post.eventStartsAt, where: post.placeName, ownerId: post.authorId });
    }
    let touched = 0;
    for (const e of events) {
      const people = new Set((await eventRoom.listGoing(e.ref)).map((g) => g.userId));
      if (e.ownerId) people.add(e.ownerId);
      if (people.size === 0) continue;
      const album = await albums.ensure({ id: ids.next(), kind: 'EVENT', refId: eventRefId(e.ref), title: e.title, placeName: e.where, startedAt: e.startsAt, createdAt: now });
      await albums.addMembers(album.id, [...people], now);
      touched += 1;
    }
    return touched;
  }

  /**
   * "Ontem em Bar X com 4 amigos": no dia seguinte ao encontro, a partir das 10 h (horário de São Paulo), cada pessoa
   * que foi recebe um aviso, uma vez só. Amigos = os outros que foram, sem quem tem bloqueio com ela.
   * Devolve quantos avisos mandou.
   */
  async sendSummaries(): Promise<number> {
    const { albums, notifier, blocks, clock } = this.deps;
    const now = clock.now();
    const local = localParts(now);
    if (local.hour < ALBUM_SUMMARY_HOUR) return 0;
    const due = (await albums.listStartedBetween(new Date(now.getTime() - RECENT_HOURS * HOUR), now, BATCH)).filter((a) => localParts(a.startedAt).day < local.day);
    let sent = 0;
    for (const album of due) {
      const members = await albums.listMembers(album.id);
      const where = album.placeName ?? album.title ?? (album.kind === 'FLASH' ? 'um encontro do NOW' : 'um evento');
      for (const userId of members) {
        const blocked = new Set(await blocks.listRelatedIds(userId));
        const friends = members.filter((id) => id !== userId && !blocked.has(id)).length;
        // Marca antes de avisar: com duas instâncias rodando juntas, o pior caso é não avisar, nunca avisar em dobro.
        if (!(await albums.markSummarized(album.id, userId, now))) continue;
        await notifier.notify({
          userId,
          type: 'ALBUM_SUMMARY',
          title: friends === 0 ? `Ontem: ${where}` : `Ontem: ${where} com ${friends} ${friends === 1 ? 'amigo' : 'amigos'}`,
          body: 'Veja o álbum e adicione suas fotos',
          url: `/albuns/${album.id}`,
          dedupeKey: `album:${album.id}:summary`,
        });
        sent += 1;
      }
    }
    return sent;
  }

  private async memberAlbum(viewerId: string, albumId: string): Promise<AlbumRecord> {
    const { albums, clock } = this.deps;
    const album = typeof albumId === 'string' && albumId !== '' && albumId.length <= 64 ? await albums.find(albumId) : undefined;
    // Quem não foi recebe o mesmo "não encontrado" de um álbum que não existe.
    if (!album || album.startedAt > clock.now() || !(await albums.isMember(album.id, viewerId))) throw notFound('Álbum não encontrado');
    return album;
  }

  private async summary(album: AlbumRecord, viewerId: string, blocked: Set<string>): Promise<AlbumSummaryView> {
    const { albums } = this.deps;
    const members = await albums.listMembers(album.id);
    const photos = (await albums.listPhotos(album.id)).filter((p) => !blocked.has(p.authorId));
    return {
      id: album.id,
      kind: album.kind,
      title: album.title,
      placeName: album.placeName,
      startedAt: album.startedAt.toISOString(),
      friendCount: members.filter((id) => id !== viewerId && !blocked.has(id)).length,
      photoCount: photos.length,
      coverPhotoId: photos[0]?.id ?? null,
    };
  }
}
