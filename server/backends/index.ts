// Picks how sessions are run: Orca CLI (claude in an Orca terminal) or headless `claude -p` behind a per-session runner.

import type { BackendsReply, ProbeInfo } from '../../shared/api.ts';
import { errMessage } from '../../shared/errors.ts';
import type { Backend, BackendId } from '../app/ports.ts';
import { BACKEND, type BackendChoice } from '../config.ts';
import type { Store } from '../store.ts';
import type { Session } from '../types.ts';
import { createHeadlessBackend, type HeadlessBackend } from './headless.ts';
import { createOrcaBackend, type OrcaBackend } from './orca.ts';

/** The backends by id. Order is preference: with none forced, the first available one is the default. */
export interface Backends {
  orca: OrcaBackend;
  headless: HeadlessBackend;
}

export interface BackendRegistry {
  /** Each backend with its own extras (the launch flows use them). */
  readonly byId: Backends;
  /** The backend named `id`, or null for a name we don't know. */
  find(id: string): Backend | null;
  /** Who drives session `s` (it may not be attached right now: see driverOf). */
  ownerOf(s: Session): Backend;
  /** The backend that can act on `s` now; throws a 'detached' error when it can't (a headless runner not connected). */
  driverOf(s: Session): Backend;
  /** GET /backends: every probe, the default, and whether PAWGENTS_OFFICE_BACKEND forced one. */
  status(): Promise<BackendsReply>;
  /** Boot: every backend's restore; how many sessions came back. */
  restore(): Promise<number>;
  shutdown(): void;
}

export function createBackendRegistry(
  byId: Backends,
  { choice = BACKEND }: { choice?: BackendChoice } = {},
): BackendRegistry {
  const all: Backend[] = Object.values(byId);
  const forced: BackendId | null = choice === 'auto' ? null : choice;
  const find = (id: string) =>
    Object.hasOwn(byId, id) ? byId[id as BackendId] : null;
  const ownerOf = (s: Session) => all.find((b) => b.owns(s)) ?? byId.orca; // orca owns every non-headless session anyway
  return {
    byId,
    find,
    ownerOf,
    driverOf(s) {
      const b = ownerOf(s);
      b.ensureAttached(s);
      return b;
    },
    async status() {
      const probes = await Promise.all(all.map((b) => b.probe()));
      const ok = (id: BackendId) =>
        probes[all.findIndex((b) => b.id === id)]?.available === true;
      // a forced backend wins only while it works; otherwise fall back like auto
      const def =
        forced && ok(forced) ? forced : (all.find((b) => ok(b.id))?.id ?? null);
      const byProbe = Object.fromEntries(
        all.map((b, i) => [b.id, probes[i]]),
      ) as Record<BackendId, ProbeInfo>;
      return {
        ...byProbe,
        default: def,
        forced: forced !== null,
      } satisfies BackendsReply;
    },
    async restore() {
      let n = 0;
      for (const b of all)
        n += b.restore
          ? await b.restore().catch((e: unknown) => {
              console.error(`[${b.id}] restore failed:`, errMessage(e));
              return 0;
            })
          : 0;
      return n;
    },
    shutdown() {
      for (const b of all) b.shutdown?.();
    },
  };
}

/** The real backends over `store`. */
export const createBackends = (store: Store) =>
  createBackendRegistry({
    orca: createOrcaBackend({ store }),
    headless: createHeadlessBackend({ store }),
  });
