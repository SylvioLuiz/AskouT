import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator } from '../ports.ts';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** UUID v4, o formato das colunas de id no Postgres. */
export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
