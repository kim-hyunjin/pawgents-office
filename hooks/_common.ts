import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from '../server/config.ts';

/** Settings files are user JSON: dynamic by nature. */
export type Settings = Record<string, any>;
export type HookHandler = {
  type?: string;
  command?: unknown;
  [key: string]: any;
};

export const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PostModelSwitch',
  'PostCompact',
];
export const SEND_SCRIPT = path.resolve(import.meta.dirname, 'send.ts');
export const HOOK_COMMAND = `"${process.execPath}" "${SEND_SCRIPT}"`;
export const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

/** True if this hook handler is ours (points at this repo's hooks/send.ts). */
export function isOurs(handler: HookHandler | null | undefined): boolean {
  return (
    !!handler &&
    handler.type === 'command' &&
    typeof handler.command === 'string' &&
    handler.command.includes(SEND_SCRIPT)
  );
}

export function readSettings(): Settings {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const text = fs.readFileSync(SETTINGS_FILE, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${SETTINGS_FILE} is not valid JSON (${errMessage(e)}). Fix it by hand first; nothing was changed.`,
    );
  }
}

/** Settings, or prints why they can't be read and exits 1 (nothing is changed). */
export function loadSettingsOrExit() {
  try {
    return readSettings();
  } catch (e) {
    console.error(errMessage(e));
    process.exit(1);
  }
}

function backupSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${SETTINGS_FILE}.bak-${stamp}`;
  fs.copyFileSync(SETTINGS_FILE, bak);
  return bak;
}

function writeSettings(settings: Settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
}

/** Backs up the current file, then writes `settings`. Returns the backup path (null if there was no file). */
export function commitSettings(settings: Settings) {
  const bak = backupSettings();
  writeSettings(settings);
  return bak;
}
