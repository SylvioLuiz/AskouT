import { defineRepositoryContract } from './testing/contracts.ts';
import { makeInMemoryHarness } from './testing/in-memory-harness.ts';

defineRepositoryContract('em memória', makeInMemoryHarness);
