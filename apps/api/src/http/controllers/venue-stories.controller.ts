import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { CORE } from '../tokens.ts';

type Res = { status(code: number): unknown; setHeader(name: string, value: string): unknown };

/** Corpo cru (foto ou vídeo) como bytes. */
function bytesOf(body: unknown): Uint8Array | undefined {
  return Buffer.isBuffer(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
}

/** Stories públicos de locais verificados: Home, "Rolando agora" do Explorar, painel do local, denúncia e gestão. */
@Controller()
export class VenueStoriesController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Home: stories dos locais que você segue. */
  @Get('venue-stories/home')
  home(@CurrentActor() actor: Actor) {
    return this.core.venueStories.home(actor.userId).then((groups) => ({ groups }));
  }

  /** Explorar: faixa "Rolando agora". A posição (lat, lng) vale só nesta consulta e é arredondada. */
  @Get('venue-stories/rolling-now')
  rollingNow(@CurrentActor() actor: Actor, @Query() query: { lat?: unknown; lng?: unknown; radiusKm?: unknown }) {
    return this.core.venueStories.rollingNow(actor.userId, query).then((items) => ({ items }));
  }

  /** Configuração: não ver stories de locais e a lista de locais silenciados. */
  @Get('venue-stories/settings')
  settings(@CurrentActor() actor: Actor) {
    return this.core.venueStories.settings(actor.userId);
  }

  @Put('venue-stories/settings')
  setSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.venueStories.setSettings(actor.userId, asBody(body));
  }

  /** "Não tenho interesse" neste local. */
  @Put('venue-stories/venues/:venueId/mute')
  mute(@CurrentActor() actor: Actor, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() body: unknown) {
    return this.core.venueStories.setMuted(actor.userId, venueId, asBody(body).muted);
  }

  @Post('venue-stories/:id/report')
  @HttpCode(200)
  report(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.venueStories.report(actor.userId, id, b.reason, b.details);
  }

  /** Foto ou vídeo (com Range). O id é aleatório; some quando o story acaba. */
  @Public()
  @Get('venue-stories/:id/media')
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Accept-Ranges', 'bytes')
  async media(@Param('id') id: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) res: Res) {
    const media = await this.core.venueStories.media(id);
    if (!media) throw new NotFoundException();
    const total = media.data.byteLength;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (!m || (m[1] === '' && m[2] === '')) return new StreamableFile(media.data, { type: media.mime, length: total });
    const suffix = m[1] === '';
    const start = suffix ? Math.max(0, total - Number(m[2])) : Number(m[1]);
    const end = suffix || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
    if (start >= total || start > end) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${total}`);
      return new StreamableFile(new Uint8Array(0), { type: media.mime });
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    return new StreamableFile(media.data.subarray(start, end + 1), { type: media.mime, length: end - start + 1 });
  }

  // ---------- Painel do local (responsável) ----------

  @Get('me/venues/:venueId/stories')
  ownerList(@CurrentActor() actor: Actor, @Param('venueId', new ParseUUIDPipe()) venueId: string) {
    return this.core.venueStories.ownerList(actor.userId, venueId);
  }

  /** O corpo é o arquivo cru (`Content-Type: image/jpeg`, `video/mp4`...). */
  @Post('me/venues/:venueId/stories')
  @HttpCode(200)
  publish(@CurrentActor() actor: Actor, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    return this.core.venueStories.publish(actor.userId, venueId, contentType, bytesOf(body));
  }

  @Delete('me/venues/:venueId/stories/:storyId')
  remove(@CurrentActor() actor: Actor, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Param('storyId', new ParseUUIDPipe()) storyId: string) {
    return this.core.venueStories.remove(actor.userId, venueId, storyId);
  }

  // ---------- Gestão ----------

  @Get('admin/reports/venue-stories')
  adminReports(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.venueStories.adminReports(actor, q);
  }

  @Post('admin/reports/venue-stories/:id/resolve')
  @HttpCode(200)
  adminResolve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.venueStories.adminResolve(actor, id, b.resolution, b.note);
  }

  @Delete('admin/venue-stories/:id')
  adminRemove(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.venueStories.adminRemove(actor, id, asBody(body).note);
  }

  @Get('admin/venue-stories/:id/media')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'inline')
  async adminMedia(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const media = await this.core.venueStories.adminMedia(actor, id);
    if (!media) throw new NotFoundException();
    return new StreamableFile(media.data, { type: media.mime });
  }
}
