#!/usr/bin/env bun
// Registers pawgents-office hooks in ~/.claude/settings.json. Idempotent; backs up first.
//   bun hooks/install.ts [--dry-run]
import { commandGroup } from '../shared/hook-group.ts';
import {
  commitSettings,
  EVENTS,
  HOOK_COMMAND,
  type HookGroup,
  isOurs,
  loadSettingsOrExit,
  SETTINGS_FILE,
  type Settings,
} from './_common.ts';

/**
 * Adds a `command` hook group to every event in EVENTS that has none of ours. Mutates `settings`.
 * Null if `settings.hooks` is not an object (nothing is changed); `skipped` lists events whose value is not an array.
 */
export function addOurHooks(settings: Settings, command = HOOK_COMMAND) {
  if (
    settings.hooks &&
    (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))
  )
    return null;
  const hooks = (settings.hooks ??= {}) as Record<string, unknown>;
  const added: string[] = [];
  const skipped: string[] = [];
  for (const event of EVENTS) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) {
      skipped.push(event);
      continue;
    }
    const list: unknown[] = groups ?? (hooks[event] = []);
    const present = list.some((g) => {
      const handlers = (g as HookGroup | null)?.hooks;
      return Array.isArray(handlers) && handlers.some(isOurs);
    });
    if (present) continue;
    list.push(commandGroup(command, { async: true }));
    added.push(event);
  }
  return { added, skipped };
}

/** Returns the exit code. */
export function main(argv = process.argv) {
  const dryRun = argv.includes('--dry-run');
  const settings = loadSettingsOrExit();
  const result = addOurHooks(settings);
  if (!result) {
    console.error(
      `"hooks" in ${SETTINGS_FILE} is not an object; refusing to touch it.`,
    );
    return 1;
  }
  for (const event of result.skipped)
    console.error(`hooks.${event} is not an array; skipping`);
  const { added } = result;

  if (!added.length) {
    console.log(
      `pawgents-office hooks already installed in ${SETTINGS_FILE} — no changes.`,
    );
    return 0;
  }
  if (dryRun) {
    console.log(`[dry-run] would add hooks for: ${added.join(', ')}\n`);
    console.log(JSON.stringify(settings, null, 2));
    return 0;
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
  return 0;
}

if (import.meta.main) process.exitCode = main();
