import path from 'node:path';

export { MAX_REPLY_CHARS } from '../shared/limits.ts';
// Env-derived settings live in shared/node/env.ts (the hooks read them too); the server's tuning constants are below.
export {
  BACKEND,
  BASE_URL,
  type BackendChoice,
  CLAUDE_BIN,
  CLAUDE_BIN_EXPLICIT,
  CLAUDE_DIR,
  type Config,
  config,
  DATA_DIR,
  HEADLESS_SETTINGS_FILE,
  HOST,
  loadConfig,
  ORCA_BIN,
  PERMISSION_WAIT_MS,
  PID_FILE,
  PORT,
  PROJECTS_DIR,
  RUN_DIR,
  SESSIONS_DIR,
  SKINS_DIR,
  STATE_FILE,
} from '../shared/node/env.ts';

export const BACKEND_PROBE_TTL_MS = 30_000; // how long a backend's availability is trusted before probing again
export const HEADLESS_LAUNCH_WAIT_MS = 5000; // a new runner must write its run file within this
export const HEADLESS_EARLY_EXIT_MS = 1500; // claude exiting this soon after start = bad login / flag, reported to the launcher
export const RUNNER_CMD_TIMEOUT_MS = 3000; // a runner answers every command at once; silence means it's wedged
export const RUNNER_RECONNECT_MS = 2000; // a dropped runner socket is retried every ... (while the runner pid lives)
export const RUNNER_RECONNECT_TRIES = 5;
export const PERMISSION_HEARTBEAT_MS = 20_000; // a space every ... keeps the hook's fetch (undici: 300 s body timeout) alive
export const MAX_PROMPT_CHARS = 20_000;

export const WEB_DIR = path.resolve(import.meta.dirname, '../web');
export const SHARED_DIR = path.resolve(import.meta.dirname, '../shared'); // served at /shared/: the browser imports it too

export const SEATS_PER_DESK = 3;
export const LOG_SIZE = 100;
export const SNAPSHOT_LOG = 30;
export const MAX_FILES = 200; // files remembered per session (the panel's "worked files")
export const SNAPSHOT_FILES = 40; // of those, how many each session event carries
export const MAX_DIFF_BYTES = 2 * 1024 * 1024; // git output read per diff request
export const MAX_DIFF_CHARS = 400_000; // patch length sent to the browser
export const GIT_TIMEOUT_MS = 5_000;
export const FILES_DEBOUNCE_MS = 1_000; // git status after an edit / shell command, at most this often per session
export const FILES_SYNC_MS = 15_000; // …and this often regardless, for changes no hook announces

export const SUBAGENT_TTL_MS = 10_000; // remove ended subagents after
export const SUBAGENT_STALE_MS = 10 * 60_000; // subagent with no events for this long is considered finished
export const SESSION_TTL_MS = 5 * 60_000; // remove ended sessions after
export const ORPHAN_SESSION_MS = 30 * 60_000; // hook-only session (no pid) with no events for this long is considered gone
export const DESK_MEMORY_MS = 24 * 3600_000; // forget desk assignment after
export const GC_INTERVAL_MS = 5_000;
export const REGISTRY_POLL_MS = 3_000;
export const TRANSCRIPT_POLL_MS = 2_000;
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
export const STALE_TOOL_MS = 60_000;
export const MAX_BODY_BYTES = 1024 * 1024;
export const SSE_HEARTBEAT_MS = 15_000;
