// Domain vocabulary both sides judge the same way: which states count as working, which model families exist.
import type { EntityState } from './api.ts';

const BUSY_STATES: ReadonlySet<EntityState> = new Set<EntityState>([
  'thinking',
  'reading',
  'coding',
  'terminal',
  'searching',
  'delegating',
  'working',
]);
/** Working on a turn (not idle, waiting for the user, or off duty). */
export const isBusyState = (s: EntityState) => BUSY_STATES.has(s);

/** Model families a cat is drawn for; 'other' catches models we don't know. */
export const CAT_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku', 'other'] as const;
export type CatFamily = (typeof CAT_FAMILIES)[number];
export const isCatFamily = (f: string): f is CatFamily =>
  (CAT_FAMILIES as readonly string[]).includes(f);
