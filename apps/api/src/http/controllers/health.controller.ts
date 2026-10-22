import { Controller, Get } from '@nestjs/common';
import { Public } from '../decorators.ts';

/** Para a hospedagem saber que a API está de pé. Não toca no banco nem devolve dado nenhum. */
@Controller()
export class HealthController {
  @Public()
  @Get('saude')
  health() {
    return { ok: true };
  }
}
