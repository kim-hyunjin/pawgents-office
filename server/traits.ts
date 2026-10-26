// What the hooks and the registry mean for a session depends on who drives it. The reducer and the registry poll
// can't ask a backend instance, so the facts they need are kept here, keyed by Session.backend.
import type { Backend } from '../shared/api.ts';
import type { Session } from './types.ts';

export interface SessionTraits {
  /**
   * Permission requests show as a dialog in the session's terminal (Session.asking, mirrored by its registry status).
   * Otherwise they are parked hooks (pendingPermissions) and the registry knows nothing of the wait.
   */
  terminalDialogs: boolean;
  /** A hook-reported Orca terminal handle binds the session to that terminal (a runner's claude inherits none). */
  bindsTerminal: boolean;
}

const INTERACTIVE: SessionTraits = {
  terminalDialogs: true,
  bindsTerminal: true,
};
const TRAITS: Record<Backend, SessionTraits> = {
  orca: INTERACTIVE,
  headless: { terminalDialogs: false, bindsTerminal: false },
};

/** `s`'s traits; a session no backend claims (backend null) is an interactive terminal one. */
export const traitsOf = (s: Pick<Session, 'backend'>): SessionTraits =>
  s.backend ? TRAITS[s.backend] : INTERACTIVE;
