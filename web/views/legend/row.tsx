// A row of the 모델 안내 dialog (its cats, title and lines) and what the rows share while the dialog is open.

import type { ComponentChildren } from 'preact';
import { h } from 'preact';
import type { SessionSnapshot } from '../../../shared/api.ts';
import type { useArm, useKeyMap, useKeySet } from '../../common/hooks.ts';
import { Pic } from '../../common/pic.tsx';
import {
  BREEDS,
  breedPalette,
  type Palette,
  type Sprite,
  sprite,
} from '../../scene/sprites.ts';

export type Sessions = Map<string, SessionSnapshot>;
export const ZOOM = 2;

/** What the rows share while the dialog is mounted: picks the server hasn't confirmed, requests in flight, errors. */
export interface Ctx {
  sessions: Sessions;
  picking: ReturnType<typeof useKeyMap<string, string>>; // family -> breed picked, until the server's settings push confirms it
  busy: ReturnType<typeof useKeySet<string>>; // 'fam:…' / 'skin:…' with a request in flight
  errs: ReturnType<typeof useKeyMap<string, string>>; // same keys -> what went wrong, shown under that row
  delArm: ReturnType<typeof useArm<string>>; // skin id whose 삭제 button waits for the confirming click
  /** Run row `key`'s request: its controls off meanwhile, its error under the row if it fails (then `undo`). */
  run: (key: string, req: () => Promise<unknown>, undo?: () => void) => void;
}

export const cat = (pal: Palette, anim = 'idle') => sprite(pal, anim, 0);

/** Pictures for a breed or skin: every coat of a breed, or a skin's seated and walking frames. */
export function looks(breed: string, kind = 'employee'): Sprite[] {
  if (BREEDS[breed])
    return BREEDS[breed].coats.map((_, i) => cat(breedPalette(breed, i, kind)));
  const pal = breedPalette(breed, 0, kind);
  return kind === 'assistant' ? [cat(pal)] : [cat(pal), cat(pal, 'walk')];
}

export function Row({
  cats,
  title,
  extra,
  lines,
  err,
  tail,
}: {
  cats: Sprite[];
  title: string;
  /** after the title (the breed picker) */
  extra?: ComponentChildren;
  lines: string[];
  err?: string;
  /** after the text (a skin's 삭제 button) */
  tail?: ComponentChildren;
}) {
  return (
    <li>
      <div class="cats">
        {cats.map((c, i) => (
          // a row's pictures only change all together
          <Pic key={i} img={c} zoom={ZOOM} />
        ))}
      </div>
      <div>
        <b>{title}</b>
        {extra}
        {lines.map((l) => (
          <div key={l} class="dim">
            {l}
          </div>
        ))}
        {err && <div class="err">실패: {err}</div>}
      </div>
      {tail}
    </li>
  );
}
