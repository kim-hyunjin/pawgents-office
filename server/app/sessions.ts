// What can happen to a session from the outside: hooks arriving, and (see the routes) the browser's actions.
import { scheduleFileSync } from '../files.ts';
import { type HookOutcome, reduceHook } from '../reducer.ts';
import type { Store } from '../store.ts';
import type { HookEvent, Session } from '../types.ts';

/** Carry out what a hook asked for once the store took it in (reducer.ts HookEffect). */
export function runEffects(store: Store, { session, effects }: HookOutcome) {
  for (const e of effects)
    if (e.type === 'syncFiles') scheduleFileSync(store, session);
}

/** A hook payload from POST /hook: into the store, then its effects. Returns the session (or null). */
export function receiveHook(store: Store, ev: HookEvent): Session | null {
  const r = reduceHook(store, ev);
  if (!r) return null;
  runEffects(store, r);
  return r.session;
}
