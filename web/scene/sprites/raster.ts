// Programmatic pixel sprites: string art → cached OffscreenCanvas. No image assets.
// Everyone is a cat: front-facing and seated when at a station, side-on and running when moving.
import { SHEETS } from '../cats.ts';
import type { BreedShape, Coat, Palette, Sprite } from './data.ts';
import { FAMILIES, SKIN_ROWS } from './data.ts';
import { breedPalette } from './palette.ts';
import { skinFrames, skinScale, skins } from './skins.ts';

/*
 * Body shape, applied to every frame's string art when it is rasterized, so all poses agree.
 *   ears:  'big' taller (+1 row) · 'small' shorter (−1 row) · 'fold' folded flat (−2 rows) · 'tufted' lynx tips (+1 row)
 *   build: 'slim' rangy (+1 body row) · 'cobby' round (+1 column, −1 body row) · 'large' (+1 column, +1 body row)
 *          · 'short' short legs (−1 leg row)
 *   spots: leopard-like spots (S) sprinkled over the fur (F)
 */
const SIDE_ON = /^(walk|sit|scratch|side)/; // sprites drawn in profile, head to the right
function shapeRows(
  rows: string[],
  shape: BreedShape | undefined,
  anim: string,
) {
  if (!shape || (!shape.ears && !shape.build && !shape.spots)) return rows;
  let r = rows.slice();
  const top = r[0] ?? ''; // frames are never empty
  if (shape.ears === 'big') r.unshift(top);
  else if (shape.ears === 'tufted') r.unshift(top.replace(/O/g, 'S'));
  else if (shape.ears === 'small') r.shift();
  else if (shape.ears === 'fold') r.splice(0, 2);
  const body = Math.floor(r.length * 0.6);
  if (shape.build === 'slim' || shape.build === 'large')
    r.splice(body, 0, r[body] ?? ''); // body < r.length
  if (shape.build === 'cobby') r.splice(body, 1);
  if (shape.build === 'short') r.splice(r.length - 3, 1); // a row of leg (the paws stay)
  if (shape.build === 'cobby' || shape.build === 'large') {
    // widen through the middle of the body
    const w = Math.max(...r.map((x) => x.length));
    const col = SIDE_ON.test(anim)
      ? Math.floor(w * 0.4)
      : Math.floor(w / 2) - 1;
    r = r.map((x) => (x.length > col ? x.slice(0, col + 1) + x.slice(col) : x));
  }
  // spots: a staggered lattice of dark dots over plain fur, so the coat reads as spotted in every pose
  if (shape.spots)
    r = r.map((row, y) =>
      [...row]
        .map((c, x) =>
          c === 'F' && y % 3 === 1 && (x + y) % 4 === 0 ? 'S' : c,
        )
        .join(''),
    );
  return r;
}

// The cat sheets themselves (string art per pose) live in cats.ts.
const { employee: E } = SHEETS;

const cache = new Map<string, Sprite>();

/** Returns an OffscreenCanvas with the frame rasterized in the given palette. */
export function sprite(pal: Palette, anim: string, frame: number): Sprite {
  if (pal.skin) return skinSprite(pal, anim, frame);
  anim = anim.replace(/^(back|side):/, ''); // a skin's pose name, drawn as a cat while the skin is gone
  const sheet = SHEETS[pal.kind] || E;
  const frames = sheet[anim] || sheet.idle;
  const key = `${pal.kind}|${pal.breed || pal.fam}|${pal.variant}|${anim}|${frame % frames.length}`;
  let c = cache.get(key);
  if (c) return c;
  const rows = shapeRows(frames[frame % frames.length] ?? [], pal.shape, anim);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  for (const [y, row] of rows.entries()) {
    for (let x = 0; x < row.length; x++) {
      const color = pal[row.charAt(x) as keyof Coat | 'W' | 'L' | 'D'];
      if (!color) continue; // '.' and absent features (e.g. no ruff on short-haired breeds)
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}

const outlines = new WeakMap<Sprite, Map<string, Sprite>>(); // sprite canvas -> Map(color -> canvas)

const OUTLINE_W = 2;

/**
 * An OUTLINE_W-px outline (world pixels) hugging the sprite's opaque pixels, on a canvas that much larger each way.
 * It shares the sprite's scale, so size both with spriteSize.
 */
export function outline(img: Sprite, color: string): Sprite {
  let byColor = outlines.get(img);
  if (!byColor) outlines.set(img, (byColor = new Map()));
  let c = byColor.get(color);
  if (c) return c;
  const r = Math.max(1, Math.round(OUTLINE_W * (img.scale || 1)));
  c = new OffscreenCanvas(img.width + r * 2, img.height + r * 2) as Sprite;
  c.scale = img.scale;
  const g = c.getContext('2d')!;
  // stamp the sprite at every offset within a rounded radius, so corners don't go square
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r + 1) g.drawImage(img, r + dx, r + dy);
    }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(img, r, r);
  byColor.set(color, c);
  return c;
}

const BACK: Record<string, string> = {
  idle: 'back',
  type: 'backType',
  read: 'back',
  write: 'back',
  wait: 'backWait',
  phone: 'backPhone',
};
/** The seen-from-behind variant of a seated animation, if the sheet has one (kittens only have back / backType). */
export function backAnim(pal: Palette, anim: string) {
  if (pal.skin) return `back:${anim}`;
  const b = BACK[anim];
  const sheet = SHEETS[pal.kind] || E;
  return b && sheet[b] ? b : sheet.back ? 'back' : anim;
}

const SIDE: Record<string, string> = {
  idle: 'side',
  type: 'sideType',
  read: 'sideRead',
  write: 'side',
  wait: 'sideWait',
  phone: 'sidePhone',
};
/** The seated-in-profile variant (facing right) of an animation, if the sheet has one. */
export function sideAnim(pal: Palette, anim: string) {
  if (pal.skin) return `side:${anim}`;
  const s = SIDE[anim];
  return s && (SHEETS[pal.kind] || E)[s] ? s : anim;
}

function skinSprite(pal: Palette, anim: string, frame: number): Sprite {
  const rows = skins.get(pal.skin!)?.rows;
  const asCat = () =>
    sprite(
      breedPalette(
        (FAMILIES[pal.fam || 'other'] ?? FAMILIES.other).breed,
        0,
        pal.kind,
        pal.fam,
      ),
      anim,
      frame,
    );
  if (!rows) return asCat(); // deleted, until re-picked
  const frames = skinFrames(rows, anim),
    i = frame % frames.length;
  const key = `skin|${pal.skin}|${pal.kind}|${anim}|${i}`;
  let c = cache.get(key);
  if (c) return c;
  const src = frames[i];
  if (!src) return asCat(); // a skin always has frames for every pose (skinFrames falls back to idle)
  c = new OffscreenCanvas(src.width, src.height) as Sprite;
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.scale = skinScale(src.height, pal.kind);
  cache.set(key, c);
  return c;
}

/** World-pixel size of a sprite: skins are drawn scaled, built-in cats 1:1. */
export function spriteSize(img: Sprite | HTMLCanvasElement | ImageBitmap) {
  const k = ('scale' in img && img.scale) || 1;
  return { w: img.width / k, h: img.height / k };
}

/** A sheet to draw over: the plain cat in every SKIN_ROWS pose, 24×24 cells, feet on each cell's bottom edge. */
export function skinTemplate() {
  const C = 24,
    pal = breedPalette('koshort', 0);
  const cols = Math.max(...SKIN_ROWS.map((a) => E[a]?.length ?? 0)); // E has every SKIN_ROWS pose
  const c = new OffscreenCanvas(C * cols, C * SKIN_ROWS.length),
    g = c.getContext('2d')!;
  for (const [r, anim] of SKIN_ROWS.entries()) {
    for (const i of (E[anim] ?? []).keys()) {
      const img = sprite(pal, anim, i);
      g.drawImage(
        img,
        i * C + Math.floor((C - img.width) / 2),
        r * C + C - img.height,
      );
    }
  }
  return c.convertToBlob({ type: 'image/png' });
}

/** Map an entity state to a sprite animation name. */
export function animFor(
  state: string,
  moving: boolean,
  station: string | null = null,
) {
  if (moving) return 'walk';
  if (station === 'plan' && state !== 'waiting') return 'write';
  if (station === 'library' && state !== 'waiting') return 'read';
  if (station === 'lounge') return 'sit';
  switch (state) {
    case 'coding':
    case 'terminal':
    case 'working':
      return 'type';
    case 'reading':
    case 'searching':
      return 'read';
    case 'waiting':
      return 'wait';
    case 'delegating':
      return 'phone';
    default:
      return 'idle';
  }
}

/** Small pixel glyphs drawn directly (no cache needed). */
export function drawGlyph(
  g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  t: number,
) {
  switch (name) {
    case 'dots': {
      const n = Math.floor(t / 300) % 4;
      g.fillStyle = '#f4f4f4';
      for (let i = 0; i < 3; i++) if (i < n) g.fillRect(x + i * 3, y, 2, 2);
      break;
    }
    case 'bang': {
      const bob = Math.floor(t / 250) % 2;
      g.fillStyle = '#ffd166';
      g.fillRect(x, y - bob, 2, 5);
      g.fillRect(x, y + 6 - bob, 2, 2);
      break;
    }
    case 'zzz': {
      const ph = (t % 12000) / 1000;
      if (ph > 4) return;
      const rise = Math.floor(ph * 1.5);
      g.fillStyle = '#cfd8e3';
      for (let i = 0; i < 3; i++) {
        const zx = x + i * 3,
          zy = y + 2 - rise - i * 2;
        g.fillRect(zx, zy, 3, 1);
        g.fillRect(zx + 1, zy + 1, 1, 1);
        g.fillRect(zx, zy + 2, 3, 1);
      }
      break;
    }
    case 'plane': {
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, 3, 1);
      g.fillRect(x, y + 1, 2, 1);
      g.fillRect(x, y + 2, 1, 1);
      break;
    }
    case 'check': {
      // acceptEdits
      g.fillStyle = '#22c55e';
      g.fillRect(x, y + 2, 1, 1);
      g.fillRect(x + 1, y + 3, 1, 1);
      g.fillRect(x + 2, y + 2, 1, 1);
      g.fillRect(x + 3, y + 1, 1, 1);
      g.fillRect(x + 4, y, 1, 1);
      break;
    }
    case 'term': {
      // shell running: tiny terminal window with a prompt and blinking cursor
      g.fillStyle = '#5dff7a';
      g.fillRect(x, y, 9, 6);
      g.fillStyle = '#0a120a';
      g.fillRect(x + 1, y + 1, 7, 4);
      g.fillStyle = '#5dff7a';
      g.fillRect(x + 2, y + 2, 1, 1);
      g.fillRect(x + 3, y + 3, 1, 1);
      g.fillRect(x + 2, y + 4, 1, 1); // '>'
      if (Math.floor(t / 400) % 2) g.fillRect(x + 5, y + 3, 2, 1); // '_'
      break;
    }
    case 'cup': {
      // coffee in hand
      g.fillStyle = '#fafafa';
      g.fillRect(x, y, 3, 3);
      g.fillStyle = '#6f4e37';
      g.fillRect(x, y, 3, 1);
      g.fillStyle = '#fafafa';
      g.fillRect(x + 3, y + 1, 1, 1);
      if (Math.floor(t / 500) % 2) {
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(x + 1, y - 2, 1, 1);
      }
      break;
    }
  }
}
