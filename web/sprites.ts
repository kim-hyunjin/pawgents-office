// Programmatic pixel sprites: string art → cached OffscreenCanvas. No image assets.

import type { Sheet } from './cats.ts';
import { SHEETS } from './cats.ts';
// Everyone is a cat: front-facing and seated when at a station, side-on and running when moving.

/** A rasterized frame; skins carry `scale` (sheet pixels per world pixel). */
export type Sprite = OffscreenCanvas & { scale?: number };
/** Coat colors by palette key (see below); R is null on short-haired breeds. */
export interface Coat {
  F: string;
  S: string;
  A: string;
  T: string;
  C: string;
  U: string;
  P: string;
  N: string;
  E: string;
  R: string | null;
  O: string;
}
export interface BreedShape {
  ears?: string;
  build?: string;
  spots?: boolean;
}
export interface Breed {
  name: string;
  shape: BreedShape;
  coats: Coat[];
}
/** A cat's look: who it is (fam / breed / variant / kind) plus its colors, or a `skin` id for an uploaded sheet. */
export interface Palette extends Partial<Coat> {
  fam: string | null;
  breed?: string;
  variant: number;
  kind: string;
  skin?: string;
  shape?: BreedShape;
  W?: string;
  L?: string;
  D?: string;
}
export interface Family {
  label: string;
  title: string;
  breed: string;
  tier: number;
  monitor: string;
}
export interface LoadedSkin {
  id: string;
  name: string;
  cellW: number;
  cellH: number;
  rows: Record<string, Sprite[]> | null;
  failed: boolean;
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Coat colors. F fur, S markings (ticking / stripes), A ears, T tail, C chest + belly, U muzzle,
// P paws, N nose, E eyes, R long-hair ruff (only fluffy breeds; transparent otherwise).
const coat = (
  F: string,
  S: string,
  A: string,
  T: string,
  C: string,
  U: string,
  P: string,
  N: string,
  E: string,
  R: string | null = null,
): Coat => ({
  F,
  S,
  A,
  T,
  C,
  U,
  P,
  N,
  E,
  R,
  O: shade(F, 0.45),
});
/** A color darkened toward black (k = 1 keeps it): the outline is the fur at about half brightness. */
function shade(hex: string, k: number) {
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

// Breeds and their coat variants (sessions of the same model still differ by variant).
// Long-haired breeds set R, the neck ruff.
export const BREEDS: Record<string, Breed> = {
  abyssinian: {
    name: '아비시니안',
    shape: { ears: 'big', build: 'slim' },
    coats: [
      coat(
        '#c0703a',
        '#7a3f1d',
        '#8a4a24',
        '#8a4a24',
        '#e8b98a',
        '#f0d2b0',
        '#9a5228',
        '#c0505a',
        '#9bc53d',
      ), // ruddy
      coat(
        '#d1a27a',
        '#9a6a45',
        '#a8784f',
        '#a8784f',
        '#f1d9bd',
        '#f6e4cf',
        '#a8784f',
        '#c56a72',
        '#d4a72c',
      ), // fawn
      coat(
        '#8f8a9a',
        '#5d5868',
        '#6f6a7a',
        '#6f6a7a',
        '#d8c7b4',
        '#e6d9cc',
        '#6f6a7a',
        '#b8737e',
        '#d4a72c',
      ), // blue
    ],
  },
  siamese: {
    name: '샴',
    shape: { ears: 'big', build: 'slim' },
    coats: [
      coat(
        '#efe3cc',
        '#efe3cc',
        '#4a3426',
        '#4a3426',
        '#f7efe0',
        '#4a3426',
        '#4a3426',
        '#2a1d16',
        '#4aa3ff',
      ), // seal point
      coat(
        '#eceff2',
        '#eceff2',
        '#6b7a90',
        '#6b7a90',
        '#f7f8fa',
        '#6b7a90',
        '#6b7a90',
        '#4a5568',
        '#4aa3ff',
      ), // blue point
      coat(
        '#f6f1ee',
        '#f6f1ee',
        '#9a8a96',
        '#9a8a96',
        '#fbf8f6',
        '#9a8a96',
        '#9a8a96',
        '#7d6b78',
        '#6cb8ff',
      ), // lilac point
    ],
  },
  russianblue: {
    name: '러시안블루',
    shape: {},
    coats: [
      coat(
        '#7d8a9c',
        '#7d8a9c',
        '#6c7889',
        '#7d8a9c',
        '#8f9bad',
        '#8f9bad',
        '#6c7889',
        '#5b6b80',
        '#5fd36a',
      ),
      coat(
        '#6f7c8f',
        '#6f7c8f',
        '#5f6b7c',
        '#6f7c8f',
        '#818ea1',
        '#818ea1',
        '#5f6b7c',
        '#4f5f74',
        '#7be07f',
      ),
    ],
  },
  persian: {
    name: '페르시안',
    shape: { ears: 'small', build: 'cobby' },
    coats: [
      coat(
        '#f6f3ee',
        '#f6f3ee',
        '#e6ded1',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#f2a0b0',
        '#e0892c',
        '#ece6dc',
      ), // white, copper eyes
      coat(
        '#f1dcb8',
        '#f1dcb8',
        '#e2c79c',
        '#f6e6c8',
        '#fbf0dc',
        '#fbf0dc',
        '#fbf0dc',
        '#e8949f',
        '#e0892c',
        '#e9d2aa',
      ), // cream
      coat(
        '#d9dde3',
        '#b9bec7',
        '#c3c8d0',
        '#e6e9ee',
        '#f2f4f7',
        '#f2f4f7',
        '#f2f4f7',
        '#e8949f',
        '#4fb36a',
        '#cfd4db',
      ), // silver chinchilla
    ],
  },
  koshort: {
    name: '코숏',
    shape: {},
    coats: [
      coat(
        '#e8913a',
        '#b8601c',
        '#c56f24',
        '#c56f24',
        '#fde7c8',
        '#fde7c8',
        '#fde7c8',
        '#f28b9a',
        '#1a1a2e',
      ), // orange tabby
      coat(
        '#9aa3ad',
        '#5f6873',
        '#6b7480',
        '#6b7480',
        '#eef1f4',
        '#eef1f4',
        '#eef1f4',
        '#e88a9a',
        '#1a1a2e',
      ), // grey tabby
      coat(
        '#2b2b35',
        '#2b2b35',
        '#1b1b22',
        '#1b1b22',
        '#f4f4f4',
        '#f4f4f4',
        '#f4f4f4',
        '#f29aaa',
        '#9be15d',
      ), // tuxedo
      coat(
        '#2b2b35',
        '#2b2b35',
        '#1b1b22',
        '#1b1b22',
        '#2b2b35',
        '#2b2b35',
        '#2b2b35',
        '#d9768a',
        '#d4e84a',
      ), // black
      coat(
        '#f4f1ea',
        '#e8913a',
        '#2b2b35',
        '#2b2b35',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#f4a3b4',
        '#1a1a2e',
      ), // calico
    ],
  },
  bengal: {
    name: '벵갈',
    shape: { build: 'slim', spots: true },
    coats: [
      coat(
        '#d9a441',
        '#5a3a1a',
        '#7a4a1e',
        '#7a4a1e',
        '#f3dfb0',
        '#f3dfb0',
        '#5a3a1a',
        '#c0505a',
        '#4fb06b',
      ), // brown spotted
      coat(
        '#c98a3a',
        '#4a2e14',
        '#6a3f18',
        '#6a3f18',
        '#efd3a6',
        '#efd3a6',
        '#4a2e14',
        '#b8505a',
        '#d4a72c',
      ), // rufous spotted
    ],
  },
  ragdoll: {
    name: '랙돌',
    shape: { build: 'large' },
    coats: [
      coat(
        '#efe6d8',
        '#efe6d8',
        '#5a4334',
        '#5a4334',
        '#ffffff',
        '#5a4334',
        '#ffffff',
        '#3a2a20',
        '#3f8fe8',
        '#f6efe4',
      ), // seal mitted
      coat(
        '#e9ecf0',
        '#e9ecf0',
        '#7a8798',
        '#7a8798',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#e8a0b0',
        '#3f8fe8',
        '#f2f4f7',
      ), // blue bicolor
    ],
  },
  mainecoon: {
    name: '메인쿤',
    shape: { ears: 'tufted', build: 'large' },
    coats: [
      coat(
        '#8a6a48',
        '#3e2c1c',
        '#5a4330',
        '#5a4330',
        '#d9c3a0',
        '#e8d6b8',
        '#d9c3a0',
        '#b0605a',
        '#d4a72c',
        '#b89a76',
      ), // brown tabby
      coat(
        '#c8743a',
        '#8a4519',
        '#a05a28',
        '#a05a28',
        '#f2d1a8',
        '#f2d1a8',
        '#f2d1a8',
        '#d07a70',
        '#d4a72c',
        '#e0a06a',
      ), // red
    ],
  },
  british: {
    name: '브리티시 숏헤어',
    shape: { ears: 'small', build: 'cobby' },
    coats: [
      coat(
        '#7f8894',
        '#7f8894',
        '#6c7480',
        '#7f8894',
        '#8e97a3',
        '#9aa3ae',
        '#6c7480',
        '#56606c',
        '#e8a33a',
      ), // blue
      coat(
        '#b9a9b0',
        '#b9a9b0',
        '#a3939a',
        '#b9a9b0',
        '#c8babf',
        '#d2c6ca',
        '#a3939a',
        '#9a7d88',
        '#e8a33a',
      ), // lilac
    ],
  },
  sphynx: {
    name: '스핑크스',
    shape: { ears: 'big', build: 'slim' },
    coats: [
      coat(
        '#e8c0b0',
        '#d9a898',
        '#d9a0a0',
        '#e8c0b0',
        '#f2d4c8',
        '#f2d4c8',
        '#e8b0a8',
        '#d08090',
        '#7ac87a',
      ), // pink
      coat(
        '#b8adab',
        '#9a8f8d',
        '#a89a98',
        '#b8adab',
        '#d6cdcb',
        '#d6cdcb',
        '#a89a98',
        '#c08088',
        '#e8c84a',
      ), // grey
    ],
  },
  norwegian: {
    name: '노르웨이 숲',
    shape: { ears: 'tufted', build: 'large' },
    coats: [
      coat(
        '#a8adb3',
        '#4a4f56',
        '#6a7078',
        '#6a7078',
        '#eef0f2',
        '#eef0f2',
        '#eef0f2',
        '#c08090',
        '#9bc53d',
        '#d8dce0',
      ), // silver tabby
      coat(
        '#7a5a3a',
        '#3a2818',
        '#4e3826',
        '#4e3826',
        '#e8d8c0',
        '#e8d8c0',
        '#e8d8c0',
        '#a8605a',
        '#9bc53d',
        '#a88a68',
      ), // brown tabby
    ],
  },
  bombay: {
    name: '봄베이',
    shape: {},
    coats: [
      coat(
        '#1d1d24',
        '#1d1d24',
        '#141419',
        '#141419',
        '#26262e',
        '#26262e',
        '#1d1d24',
        '#3a3a44',
        '#e8a33a',
      ),
    ],
  },
  turkishangora: {
    name: '터키시 앙고라',
    shape: { ears: 'big', build: 'slim' },
    coats: [
      coat(
        '#fbfbfb',
        '#fbfbfb',
        '#f0d8d8',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#f4a8b8',
        '#5aa8f0',
        '#f0f0f0',
      ),
    ],
  },
  scottishfold: {
    name: '스코티시 폴드',
    shape: { ears: 'fold', build: 'cobby' },
    coats: [
      coat(
        '#c9ccd2',
        '#7c8089',
        '#9a9ea6',
        '#9a9ea6',
        '#eceef1',
        '#eceef1',
        '#eceef1',
        '#d08a98',
        '#d4a72c',
      ), // silver tabby
      coat(
        '#efd9b4',
        '#d1a971',
        '#e0c08c',
        '#e0c08c',
        '#fbf1de',
        '#fbf1de',
        '#fbf1de',
        '#e0949f',
        '#d4a72c',
      ), // cream
    ],
  },
  munchkin: {
    name: '먼치킨',
    shape: { build: 'short' },
    coats: [
      coat(
        '#f2efe8',
        '#e08a3a',
        '#d07a30',
        '#d07a30',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#f4a3b4',
        '#4fb06b',
      ), // white & orange
      coat(
        '#a7a9ad',
        '#5e6167',
        '#7c7f85',
        '#7c7f85',
        '#eef0f2',
        '#eef0f2',
        '#eef0f2',
        '#d08a98',
        '#9bc53d',
      ), // grey tabby
    ],
  },
};

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
  if (shape.ears === 'big') r.unshift(r[0]);
  else if (shape.ears === 'tufted') r.unshift(r[0].replace(/O/g, 'S'));
  else if (shape.ears === 'small') r.shift();
  else if (shape.ears === 'fold') r.splice(0, 2);
  const body = Math.floor(r.length * 0.6);
  if (shape.build === 'slim' || shape.build === 'large')
    r.splice(body, 0, r[body]);
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

// Model family → default breed, roughly by how often the breed tops "smartest cat" lists
// (Abyssinian, Siamese first; Russian Blue mid-list; the placid Persian rarely appears). The user can pick others.
export const FAMILIES: Record<string, Family> = {
  fable: {
    label: 'Fable',
    title: '수석',
    breed: 'abyssinian',
    tier: 4,
    monitor: 'wide-gold',
  },
  opus: {
    label: 'Opus',
    title: '선임',
    breed: 'siamese',
    tier: 3,
    monitor: 'silver',
  },
  sonnet: {
    label: 'Sonnet',
    title: '사원',
    breed: 'russianblue',
    tier: 2,
    monitor: 'normal',
  },
  haiku: {
    label: 'Haiku',
    title: '인턴',
    breed: 'persian',
    tier: 1,
    monitor: 'laptop',
  },
  other: {
    label: '기타',
    title: '',
    breed: 'koshort',
    tier: 0,
    monitor: 'normal',
  },
};

let chosen: Record<string, string> = {}; // family -> breed key, set by the user (server-persisted, see office.ts)
export function setBreedChoices(map?: Record<string, string> | null) {
  chosen = { ...(map || {}) };
}
/** What the user picked for a family (a skin may still be loading), or the default breed. */
export function choiceOf(fam: string) {
  return chosen[fam] || FAMILIES[fam].breed;
}
/** The breed a model family's cats are drawn as: the user's pick if it's a known breed or a loaded skin, else the default. */
export function breedOf(fam: string) {
  const k = chosen[fam];
  return BREEDS[k] || skins.get(skinId(k)!)?.rows ? k : FAMILIES[fam].breed;
}
const skinId = (k: unknown) =>
  typeof k === 'string' && k.startsWith('skin:') ? k.slice(5) : null;

export function familyOf(model?: string | null) {
  const m = String(model || '').toLowerCase();
  if (/fable|mythos/.test(m)) return 'fable';
  if (/opus/.test(m)) return 'opus';
  if (/sonnet/.test(m)) return 'sonnet';
  if (/haiku/.test(m)) return 'haiku';
  return 'other';
}

export function paletteFor(
  id: string,
  kind = 'employee',
  model: string | null = null,
): Palette {
  const fam = familyOf(model),
    breed = breedOf(fam);
  return breedPalette(
    breed,
    (hashStr(id) >>> 4) % (BREEDS[breed]?.coats.length || 1),
    kind,
    fam,
  );
}
/** Palette for one specific coat variant of a breed (a skin has just the one look). */
export function breedPalette(
  breed: string,
  variant: number,
  kind = 'employee',
  fam: string | null = null,
): Palette {
  const sid = skinId(breed);
  if (sid) return { fam, breed, skin: sid, variant: 0, kind };
  return {
    fam,
    breed,
    variant,
    kind,
    shape: BREEDS[breed].shape,
    ...BREEDS[breed].coats[variant],
    W: '#fdfdfd',
    L: '#c8d0d8',
    D: '#111',
  };
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
  const rows = shapeRows(frames[frame % frames.length], pal.shape, anim);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const color = pal[rows[y][x] as keyof Coat | 'W' | 'L' | 'D'];
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

// ---- uploaded skins -------------------------------------------------------------------
// A skin is a PNG sheet of equal cells: one row per animation in SKIN_ROWS order, frames left to right up to the
// first empty (fully transparent) cell. Missing rows borrow a close pose (skinFrames). Frames are trimmed to one box
// shared by the whole sheet, so feet and centers line up across poses, and sized by skinScale.
export const SKIN_ROWS = [
  'idle',
  'walk',
  'type',
  'read',
  'wait',
  'phone',
  'write',
  'sit',
  'back',
  'side',
  'scratch',
  'bat',
];
export const SKIN_ROW_LABEL: Record<string, string> = {
  idle: '앉아 있기 (정면)',
  walk: '걷기 (오른쪽을 보고)',
  type: '타이핑',
  read: '책 읽기',
  wait: '손 들기',
  phone: '전화',
  write: '화이트보드에 쓰기',
  sit: '엎드리기 (라운지·낮잠)',
  back: '뒷모습 (회의 테이블·책상)',
  side: '옆으로 앉기 (오른쪽을 보고)',
  scratch: '스크래처 긁기',
  bat: '털실 치기',
};
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

const skins = new Map<string, LoadedSkin>(); // id -> { id, name, cellW, cellH, rows: { anim: [canvas] } once loaded, failed }
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
  const r = await fetch(`/skins/${skin.id}.png`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = sliceSheet(
    await createImageBitmap(await r.blob()),
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
function skinFrames(rows: Record<string, Sprite[]>, anim: string): Sprite[] {
  const m = /^(back|side):(.+)$/.exec(anim);
  if (m) return rows[m[1]] || skinFrames(rows, m[2]);
  if (rows[anim]) return rows[anim];
  if (anim === 'bat')
    return [rows.idle[0], rows.wait?.[0] || rows.idle[1] || rows.idle[0]]; // paw down, paw up
  return skinFrames(rows, SKIN_FALLBACK[anim] || 'idle');
}

function skinSprite(pal: Palette, anim: string, frame: number): Sprite {
  const rows = skins.get(pal.skin!)?.rows;
  if (!rows)
    return sprite(
      breedPalette(FAMILIES[pal.fam || 'other'].breed, 0, pal.kind, pal.fam),
      anim,
      frame,
    ); // deleted, until re-picked
  const frames = skinFrames(rows, anim),
    i = frame % frames.length;
  const key = `skin|${pal.skin}|${pal.kind}|${anim}|${i}`;
  let c = cache.get(key);
  if (c) return c;
  const src = frames[i];
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
  const cols = Math.max(...SKIN_ROWS.map((a) => E[a].length));
  const c = new OffscreenCanvas(C * cols, C * SKIN_ROWS.length),
    g = c.getContext('2d')!;
  for (const [r, anim] of SKIN_ROWS.entries()) {
    for (const i of E[anim].keys()) {
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

/** The lobby's resident receptionist: a little robot (its own sheet in cats.ts), not a cat any model could be. */
export const RECEPTIONIST_PAL: Palette = {
  fam: 'reception',
  variant: 0,
  kind: 'robot',
  O: '#3b4252',
  F: '#c9d3df',
  S: '#8fa0b5',
  A: '#8fa0b5',
  T: '#ff6b6b',
  U: '#1f2a3a',
  E: '#6ef2ff',
  N: '#6ef2ff',
  C: '#a9b8cb',
  P: '#8fa0b5',
  W: '#fdfdfd',
  D: '#2a3342',
  L: '#ffd166',
};

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
