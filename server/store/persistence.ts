// The state file (desks, cats, skins, offices): read once at boot, written debounced after every change.
import fs from 'node:fs';
import path from 'node:path';
import { safeJsonParse } from '../../shared/json.ts';
import { debounce } from '../../shared/time.ts';

export const SAVE_DEBOUNCE_MS = 500;

export class Persistence {
  file: string;
  collect: () => Record<string, unknown>;
  /** Write soon (debounced): every change calls this. */
  save: () => void;

  /** `collect`: what goes in the file, in key order (updatedAt is added last). */
  constructor(file: string, collect: () => Record<string, unknown>) {
    this.file = file;
    this.collect = collect;
    this.save = debounce(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }
  /** The parsed file: null when it is missing or not JSON. Not validated: see the repos' load(). */
  read(): unknown {
    return safeJsonParse(
      fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : '',
    );
  }
  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        this.file,
        JSON.stringify({ ...this.collect(), updatedAt: Date.now() }, null, 2),
      );
    } catch (e) {
      console.error('[store] save failed:', (e as Error).message);
    }
  }
}
