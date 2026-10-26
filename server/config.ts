import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.PAWGENTS_OFFICE_PORT || process.env.PORT || 17777);
export const HOST = '127.0.0.1';
export const BASE_URL = `http://${HOST}:${PORT}`;

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

export const DATA_DIR = process.env.PAWGENTS_OFFICE_DATA || path.join(os.homedir(), '.pawgents-office');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const PID_FILE = path.join(DATA_DIR, 'server.pid'); // written while listening; read by scripts/stop.ts
export const SKINS_DIR = path.join(DATA_DIR, 'skins');   // uploaded sprite sheets, <id>.png

// Native launcher, not orca.cmd: cmd.exe would reparse prompt text. On Linux bare `orca` is the screen reader.
export const ORCA_BIN = process.env.PAWGENTS_OFFICE_ORCA_BIN || process.env.ORCA_CLI_COMMAND
  || (process.platform === 'win32' ? 'orca.exe' : process.platform === 'linux' ? 'orca-ide' : 'orca');
export const BACKEND = /^(orca|headless)$/.test(process.env.PAWGENTS_OFFICE_BACKEND || '') ? process.env.PAWGENTS_OFFICE_BACKEND : 'auto'; // which way to run sessions; auto offers whatever is available
export const CLAUDE_BIN = process.env.PAWGENTS_OFFICE_CLAUDE_BIN || 'claude'; // headless backend's claude; override when it isn't on PATH
export const RUN_DIR = path.join(DATA_DIR, 'run'); // per-session runner files, so a restarted server can reconnect
export const BACKEND_PROBE_TTL_MS = 30_000; // how long a backend's availability is trusted before probing again
export const HEADLESS_LAUNCH_WAIT_MS = 5000;  // a new runner must write its run file within this
export const HEADLESS_EARLY_EXIT_MS = 1500;   // claude exiting this soon after start = bad login / flag, reported to the launcher
export const RUNNER_CMD_TIMEOUT_MS = 3000;    // a runner answers every command at once; silence means it's wedged
export const RUNNER_RECONNECT_MS = 2000;      // a dropped runner socket is retried every ... (while the runner pid lives)
export const RUNNER_RECONNECT_TRIES = 5;
export const HEADLESS_SETTINGS_FILE = path.join(DATA_DIR, 'headless-settings.json'); // --settings for headless claude (permission hook)
// a parked permission request answers "no decision" after this: just under the hook's own 1800 s timeout (hooks/decision.ts)
export const PERMISSION_WAIT_MS = Number(process.env.PAWGENTS_OFFICE_PERMISSION_WAIT_MS) || 1_780_000; // env: dev override to test the timeout
export const PERMISSION_HEARTBEAT_MS = 20_000; // a space every ... keeps the hook's fetch (undici: 300 s body timeout) alive
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_REPLY_CHARS = 200_000; // full markdown reply kept per entity (served on demand, not over SSE)

export const WEB_DIR = path.resolve(import.meta.dirname, '../web');

export const SEATS_PER_DESK = 3;
export const LOG_SIZE = 100;
export const SNAPSHOT_LOG = 30;
export const MAX_FILES = 200;       // files remembered per session (the panel's "worked files")
export const SNAPSHOT_FILES = 40;   // of those, how many each session event carries
export const MAX_DIFF_BYTES = 2 * 1024 * 1024; // git output read per diff request
export const MAX_DIFF_CHARS = 400_000;         // patch length sent to the browser
export const GIT_TIMEOUT_MS = 5_000;
export const FILES_DEBOUNCE_MS = 1_000;  // git status after an edit / shell command, at most this often per session
export const FILES_SYNC_MS = 15_000;     // …and this often regardless, for changes no hook announces

export const SUBAGENT_TTL_MS = 10_000;        // remove ended subagents after
export const SUBAGENT_STALE_MS = 10 * 60_000; // subagent with no events for this long is considered finished
export const SESSION_TTL_MS = 5 * 60_000;     // remove ended sessions after
export const ORPHAN_SESSION_MS = 30 * 60_000; // hook-only session (no pid) with no events for this long is considered gone
export const DESK_MEMORY_MS = 24 * 3600_000;  // forget desk assignment after
export const GC_INTERVAL_MS = 5_000;
export const REGISTRY_POLL_MS = 3_000;
export const TRANSCRIPT_POLL_MS = 2_000;
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
export const STALE_TOOL_MS = 60_000;
export const MAX_BODY_BYTES = 1024 * 1024;
export const SSE_HEARTBEAT_MS = 15_000;
