// Cat data: the breeds and their coats, model families, the receptionist robot's colors, the skin sheet's rows.
// Plain values, no drawing.

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
