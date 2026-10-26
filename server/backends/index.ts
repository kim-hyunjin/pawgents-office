// Picks how sessions are run: Orca CLI (claude in an Orca terminal) or headless `claude -p` behind a per-session runner.

import { BACKEND } from '../config.ts';
import type { Session } from '../types.ts';
import * as headless from './headless.ts';
import * as orca from './orca.ts';

export { headless, orca };

export async function backends() {
  const [o, h] = await Promise.all([orca.probe(), headless.probe()]);
  const forced = BACKEND !== 'auto',
    ok: Record<string, boolean> = { orca: o.available, headless: h.available };
  // a forced backend wins only while it works; otherwise fall back like auto
  const def =
    forced && ok[BACKEND!]
      ? BACKEND
      : ok.orca
        ? 'orca'
        : ok.headless
          ? 'headless'
          : null;
  return { orca: o, headless: h, default: def, forced };
}

/** The backend that can drive session `s`: null for a headless session whose runner we aren't connected to (yet). */
export const forSession = (s: Session) =>
  s.backend === 'headless' ? (headless.has(s.id) ? headless : null) : orca;
