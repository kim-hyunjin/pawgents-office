#!/usr/bin/env bun
// Removes pawgents-office hooks from ~/.claude/settings.json, leaving everything else intact.
import type { HookHandler } from './_common.ts';
import {
  commitSettings,
  isOurs,
  loadSettingsOrExit,
  SETTINGS_FILE,
} from './_common.ts';

const settings = loadSettingsOrExit();

let removed = 0;
if (settings.hooks && typeof settings.hooks === 'object') {
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept: unknown[] = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const before = g.hooks.length;
      g.hooks = g.hooks.filter((h: HookHandler) => !isOurs(h));
      removed += before - g.hooks.length;
      if (g.hooks.length) kept.push(g);
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
}

if (!removed) {
  console.log(
    `No pawgents-office hooks found in ${SETTINGS_FILE} — nothing to do.`,
  );
  process.exit(0);
}
const bak = commitSettings(settings);
console.log(
  `Removed ${removed} pawgents-office hook entr${removed === 1 ? 'y' : 'ies'} from ${SETTINGS_FILE}`,
);
if (bak) console.log(`  backup: ${bak}`);
