// Settings the environment decides: shared by the server, the hooks and the scripts (Node only).
import os from 'node:os';
import path from 'node:path';

export const HOST = '127.0.0.1';

export type BackendChoice = 'orca' | 'headless' | 'auto';

/** Everything the environment decides. Pure: tests pass their own `env` instead of re-importing this module. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
) {
  const PORT = Number(env.PAWGENTS_OFFICE_PORT || env.PORT || 17777);
  const CLAUDE_DIR = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const DATA_DIR =
    env.PAWGENTS_OFFICE_DATA || path.join(home, '.pawgents-office');
  const backend = env.PAWGENTS_OFFICE_BACKEND;
  return {
    PORT,
    BASE_URL: `http://${HOST}:${PORT}`,
    CLAUDE_DIR,
    SESSIONS_DIR: path.join(CLAUDE_DIR, 'sessions'),
    PROJECTS_DIR: path.join(CLAUDE_DIR, 'projects'),
    DATA_DIR,
    STATE_FILE: path.join(DATA_DIR, 'state.json'),
    PID_FILE: path.join(DATA_DIR, 'server.pid'), // written while listening; read by scripts/stop.ts
    SKINS_DIR: path.join(DATA_DIR, 'skins'), // uploaded sprite sheets, <id>.png
    RUN_DIR: path.join(DATA_DIR, 'run'), // per-session runner files, so a restarted server can reconnect
    HEADLESS_SETTINGS_FILE: path.join(DATA_DIR, 'headless-settings.json'), // --settings for headless claude (permission hook)
    // Native launcher, not orca.cmd: cmd.exe would reparse prompt text. On Linux bare `orca` is the screen reader.
    ORCA_BIN:
      env.PAWGENTS_OFFICE_ORCA_BIN ||
      env.ORCA_CLI_COMMAND ||
      (platform === 'win32'
        ? 'orca.exe'
        : platform === 'linux'
          ? 'orca-ide'
          : 'orca'),
    // which way to run sessions; auto offers whatever is available
    BACKEND: (backend === 'orca' || backend === 'headless'
      ? backend
      : 'auto') as BackendChoice,
    CLAUDE_BIN: env.PAWGENTS_OFFICE_CLAUDE_BIN || 'claude', // headless backend's claude; override when it isn't on PATH
    CLAUDE_BIN_EXPLICIT: Boolean(env.PAWGENTS_OFFICE_CLAUDE_BIN), // set by the user: used as given, no PATH lookup
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || null, // claude's own model override (headless defaultModel reads it)
    // a parked permission request answers "no decision" after this: just under the hook's own 1800 s timeout (shared/decision.ts)
    PERMISSION_WAIT_MS:
      Number(env.PAWGENTS_OFFICE_PERMISSION_WAIT_MS) || 1_780_000, // env: dev override to test the timeout
  };
}
export type Config = ReturnType<typeof loadConfig>;

export const config = loadConfig();
export const {
  PORT,
  BASE_URL,
  CLAUDE_DIR,
  SESSIONS_DIR,
  PROJECTS_DIR,
  DATA_DIR,
  STATE_FILE,
  PID_FILE,
  SKINS_DIR,
  RUN_DIR,
  HEADLESS_SETTINGS_FILE,
  ORCA_BIN,
  BACKEND,
  CLAUDE_BIN,
  CLAUDE_BIN_EXPLICIT,
  PERMISSION_WAIT_MS,
} = config;
