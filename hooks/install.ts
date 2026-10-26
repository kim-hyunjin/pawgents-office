#!/usr/bin/env bun
// Registers pawgents-office hooks in ~/.claude/settings.json. Idempotent; backs up first.
//   bun hooks/install.ts [--dry-run]
import { commandGroup } from '../shared/hook-group.ts';
import {
  commitSettings,
  EVENTS,
  HOOK_COMMAND,
  isOurs,
  loadSettingsOrExit,
  SETTINGS_FILE,
} from './_common.ts';

const dryRun = process.argv.includes('--dry-run');
const settings = loadSettingsOrExit();

if (
  settings.hooks &&
  (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))
) {
  console.error(
    `"hooks" in ${SETTINGS_FILE} is not an object; refusing to touch it.`,
  );
  process.exit(1);
}
settings.hooks ??= {};
const added: string[] = [];
for (const event of EVENTS) {
  const groups = settings.hooks[event];
  if (groups !== undefined && !Array.isArray(groups)) {
    console.error(`hooks.${event} is not an array; skipping`);
    continue;
  }
  const list = groups ?? (settings.hooks[event] = []);
  const present = list.some(
    (g: { hooks?: unknown } | null) =>
      Array.isArray(g?.hooks) && g.hooks.some(isOurs),
  );
  if (present) continue;
  list.push(commandGroup(HOOK_COMMAND, { async: true }));
  added.push(event);
}

if (!added.length) {
  console.log(
    `pawgents-office hooks already installed in ${SETTINGS_FILE} — no changes.`,
  );
  process.exit(0);
}
if (dryRun) {
  console.log(`[dry-run] would add hooks for: ${added.join(', ')}\n`);
  console.log(JSON.stringify(settings, null, 2));
  process.exit(0);
}
const bak = commitSettings(settings);
console.log(
  `Installed pawgents-office hooks for ${added.length} events: ${added.join(', ')}`,
);
console.log(`  command: ${HOOK_COMMAND}`);
if (bak) console.log(`  backup:  ${bak}`);
console.log(
  '\nNote: claude sessions that are already running keep their old hook config until restarted.',
);
