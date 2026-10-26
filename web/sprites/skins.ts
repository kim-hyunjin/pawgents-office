// Uploaded skins: PNG sprite sheets loaded from the server and cut into frames.
import { getSkinPng } from '../api.ts';
import type { LoadedSkin, Sprite } from './data.ts';
import { SKIN_ROWS } from './data.ts';

const SKIN_FALLBACK: Record<string, string> = {
  type: 'idle',
  read: 'idle',
  wait: 'idle',
  phone: 'wait',
  write: 'wait',
  sit: 'idle',
  scratch: 'idle',
  back: 'idle',
  side: 'idle',
};
// Art up to a tile and a half (24 px) tall is drawn pixel for pixel, standing taller than the tiles like characters in
// most pixel-art games. Taller sheets are high-res versions of that: drawn 2, 3, … sheet pixels per world pixel (the
// smallest whole number that fits), so a 48px-cell sheet shows twice the detail at 2× zoom. Kittens are 3/4 of that.
const SKIN_NATIVE_MAX = 24;
/** Sheet pixels per world pixel for a skin whose trimmed frames are h px tall. */
export function skinScale(h: number, kind = 'employee') {
  const k = Math.max(1, Math.ceil(h / SKIN_NATIVE_MAX));
  return kind === 'assistant' ? k / 0.75 : k;
}

export const skins = new Map<string, LoadedSkin>(); // id -> { id, name, cellW, cellH, rows: { anim: [canvas] } once loaded, failed }
let onSkinsLoaded = () => {};
/** fn() runs whenever a skin finishes loading (or fails), so cats can switch over to it. */
export function onSkinLoad(fn: () => void) {
  onSkinsLoaded = fn;
}
/** The server's skin list (snapshot or a 'settings' push): load new sheets, forget deleted ones. */
export function setSkins(
  list?: { id: string; name: string; cellW: number; cellH: number }[] | null,
) {
  const keep = new Set();
  for (const k of list || []) {
    keep.add(k.id);
    if (skins.has(k.id)) {
      skins.get(k.id)!.name = k.name;
      continue;
    }
    const skin: LoadedSkin = { ...k, rows: null, failed: false };
    skins.set(k.id, skin);
    loadSkin(skin)
      .then(
        (rows) => {
          skin.rows = rows;
        },
        (e: Error) => {
          skin.failed = true;
          console.warn(`[skin] ${k.name}: ${e.message}`);
        },
      )
      .finally(() => {
        if (skins.get(k.id) === skin) onSkinsLoaded();
      });
  }
  for (const id of skins.keys()) if (!keep.has(id)) skins.delete(id);
}
export function skinList() {
  return [...skins.values()];
}

async function loadSkin(skin: LoadedSkin) {
  const rows = sliceSheet(
    await createImageBitmap(await getSkinPng(skin.id)),
    skin.cellW,
    skin.cellH,
  );
  if (!rows.idle || !rows.walk)
    throw new Error('앉아 있기·걷기 줄이 비어 있습니다');
  return rows;
}

/** Cut a sheet into { anim: [frame canvas] }; rows without frames are left out. */
export function sliceSheet(bmp: ImageBitmap, cw: number, ch: number) {
  const c = new OffscreenCanvas(bmp.width, bmp.height),
    g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const cols = Math.floor(bmp.width / cw),
    nrows = Math.min(SKIN_ROWS.length, Math.floor(bmp.height / ch));
  let x0 = cw,
    y0 = ch,
    x1 = -1,
    y1 = -1;
  const cells: Record<string, [number, number][]> = {};
  for (let r = 0; r < nrows; r++) {
    for (let col = 0; col < cols; col++) {
      let any = false;
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          if (!px[((r * ch + y) * bmp.width + col * cw + x) * 4 + 3]) continue;
          any = true;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      if (!any) break;
      (cells[SKIN_ROWS[r]] ||= []).push([col, r]);
    }
  }
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1,
    rows: Record<string, Sprite[]> = {};
  for (const [anim, list] of Object.entries(cells)) {
    rows[anim] = list.map(([col, r]) => {
      const f = new OffscreenCanvas(w, h);
      f.getContext('2d')!.drawImage(
        c,
        col * cw + x0,
        r * ch + y0,
        w,
        h,
        0,
        0,
        w,
        h,
      );
      return f;
    });
  }
  return rows;
}

/** Frames for an animation; 'back:type' / 'side:read' are seats facing away / sideways (that row, else the pose itself). */
export function skinFrames(
  rows: Record<string, Sprite[]>,
  anim: string,
): Sprite[] {
  const m = /^(back|side):(.+)$/.exec(anim);
  if (m) return rows[m[1]] || skinFrames(rows, m[2]);
  if (rows[anim]) return rows[anim];
  if (anim === 'bat')
    return [rows.idle[0], rows.wait?.[0] || rows.idle[1] || rows.idle[0]]; // paw down, paw up
  return skinFrames(rows, SKIN_FALLBACK[anim] || 'idle');
}
