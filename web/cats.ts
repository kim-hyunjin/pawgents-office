// Cat string art: the adult (employee) and kitten (assistant) sheets, assembled from parts so every pose shares the
// same head and body. Letters are palette keys (see sprites.ts `coat`): O outline, F fur, S markings, A ears,
// T tail, C chest, U muzzle, P paws, N nose, E eyes, W white (eye shine, paper), L lines, D dark (handset, marker),
// R long-hair ruff. '.' is empty. Seated poses face the viewer; walk / sit / side* / scratch are in profile, facing
// right (the renderer mirrors them). Adults are about 16×18, kittens 12×12, drawn one art pixel per world pixel.

/** Paint `art` onto `rows` at (x, y): over the figure, or only into empty cells when `under`. Grows the frame. */
function paint(
  rows: string[],
  art: string[],
  x: number,
  y: number,
  under = false,
): string[] {
  const h = Math.max(rows.length, y + art.length);
  const w = Math.max(
    ...rows.map((r) => r.length),
    x + Math.max(...art.map((a) => a.length)),
  );
  return Array.from({ length: h }, (_, i) => {
    const line = [...(rows[i] || '').padEnd(w, '.')];
    const a = art[i - y];
    if (a)
      [...a].forEach((c, j) => {
        if (c !== '.' && (!under || line[x + j] === '.')) line[x + j] = c;
      });
    return line.join('');
  });
}
const shiftRight = (rows: string[], n: number) =>
  rows.map((r) => '.'.repeat(n) + r);

// ---- adult --------------------------------------------------------------------------------------------------------
const HEAD = [
  // front, 16 wide: ears, striped forehead, shiny eyes, muzzle and nose, ruff (R) at the cheeks
  '..O..........O..',
  '..OO........OO..',
  '..OAO......OAO..',
  '.OAAAOOOOOOAAAO.',
  '.OFFFFSSSSFFFFO.',
  '.OFFFFFSSFFFFFO.',
  '.OFFWEFFFFWEFFO.',
  '.OFFEEFFFFEEFFO.',
  'ROFFFUUNNUUFFFOR',
  'ROFFFUUUUUUFFFOR',
  '.ROOFFFFFFFFOOR.',
];
const BODY = [
  // seated, chest showing, paws (p) in front
  '..OFFFCCCCFFFO..',
  '..OFFCCCCCCFFO..',
  '..OFFCCCCCCFFO..',
  '..OFFCCCCCCFFO..',
  '..OFFFCCCCFFFO..',
  '..OFppFFFFppFO..',
  '..OOOOOOOOOOOO..',
];
const BACK_HEAD = [
  // from behind: no face, stripes down the back of the head
  '..O..........O..',
  '..OO........OO..',
  '..OFO......OFO..',
  '.OFFFOOOOOOFFFO.',
  '.OFFFFSSSSFFFFO.',
  '.OFFFFFSSFFFFFO.',
  '.OFFFFSSSSFFFFO.',
  '.OFFFFFSSFFFFFO.',
  'ROFFFFFFFFFFFFOR',
  'ROFFFFFFFFFFFFOR',
  '.ROOFFFFFFFFOOR.',
];
const BACK_BODY = [
  '..OFFFFSSFFFFO..',
  '..OFFFFFFFFFFO..',
  '..OFFFFSSFFFFO..',
  '..OFFFFFFFFFFO..',
  '..OFFFFFFFFFFO..',
  '..OFFFFFFFFFFO..',
  '..OOOOOOOOOOOO..',
];
const TAIL_UP = ['.OO', 'OTO', 'OTO', 'OTO', 'OTO', 'TO.']; // curled up the right side, behind the body
const TAIL_FLICK = ['OO.', 'OTO', '.OTO', '.OTO', 'OTO', 'TO.'];
const TAIL_FLOOR = ['.OOOO', 'OTTTT', '.OOOO']; // lying on the floor (back view)
const SIDE = [
  // seated in profile facing right: head over the chest, haunch behind
  '.......O..O...',
  '......OAOOAO..',
  '.....OFFFFFFO.',
  '....OFSFFFFFFO',
  '....OFFSFFWEFO',
  '....OFFFFFEEFO',
  '....OFFFFFFUUN',
  '....ROFFFFUUUO',
  '....ROOFFFFOO.',
  '...OFFFFFFCCO.',
  '..OSFFFFFFCCO.',
  '..OFSFFFFFCCO.',
  '.OFFFFFFFFCCO.',
  '.OFFFFFFFFCCO.',
  'OFFFFFFFFFFCO.',
  'OFFFFFFFFFFCO.',
  'OFFFFFFFFFppO.',
  'OOOOOOOOOOOOO.',
];
const SIDE_TAIL = ['.OO', 'OTO', 'OTO', 'OTO', '.O.'];
const WALK_TOP = [
  // running in profile: head right, back stretched out, tail up behind
  '...............O..O...',
  '..............OAOOAO..',
  '.............OFFFFFFO.',
  '............OFFFFFWEO.',
  '............OFFFFFEEFO',
  '.....OOOOOOOOFFFFFFUUN',
  '....OFSFFSFFSFFFFFUUO.',
  '...OFFFFFFFFFFFFFFFO..',
  '...OFFFFFFFFFFFFFFO...',
  '...OCCCCCCCCCCCFFFO...',
];
const WALK_LEGS = [
  [
    '..OFFO.........OFFO...',
    '.OFFO...........OFFO..',
    '.OPPO...........OPPO..',
  ], // stretched
  [
    '....OFFO.....OFFO.....',
    '.....OFFO...OFFO......',
    '.....OPPO...OPPO......',
  ], // gathered
  [
    '...OFFO......OFFO.....',
    '...OFFO......OFFO.....',
    '...OPPO......OPPO.....',
  ], // passing
];
const WALK_TAIL = [
  ['OO..', 'OTO.', '.OTO', '..OT'],
  ['....', 'OO..', 'OTOO', '.OTT'],
  ['.OO.', 'OTO.', '.OTO', '..OT'],
];
const LOAF = [
  // lying down in profile (lounge, nap)
  '............O..O..',
  '...........OAOOAO.',
  '....OOOOOOOFFFFFFO',
  '...OFSFFSFFFFFFWEO',
  '..OFFFFFFFFFFFFEEO',
  '.OFFFFFFFFFFFFFUUN',
  'OTFFFFFFFFFFFFFUUO',
  'OTFFFFFFFFFFFFFFO.',
  'OTFCCCCCCCCCCPPO..',
  '.OOOOOOOOOOOOOO...',
];
const SCRATCH = [
  // up on its hind legs facing right, front paws on a post at the right edge
  '....O..O....',
  '...OAOOAO...',
  '..OFFFFFFO..',
  '..OFFFFWEO..',
  '..OFFFFEEFO.',
  '..OFFFFFUUN.',
  '..ROFFFUUO..',
  '..OFFFFFFOPP',
  '..OSFFFCCO..',
  '.OFSFFCCCO..',
  '.OFFFFCCO...',
  '.OFFFFCCO...',
  '.OFFFFFFO...',
  '.OFFFFFFO...',
  '.OFFOOFFO...',
  '.OFO..OFO...',
  'TOPPO.OPPO..',
  'TT..........',
];

const PAWS_DOWN = (rows: string[]) => rows.map((r) => r.replace(/p/g, 'P'));
/** One paw lifted onto the keyboard (against the chest); the other stays down. */
const pawsUp = (rows: string[], side: string) => {
  const x = side === 'left' ? 4 : 10;
  return PAWS_DOWN(paint(paint(rows, ['FF'], x, 16), ['PP'], x, 14));
};
const front = (tail = TAIL_UP) => paint([...HEAD, ...BODY], tail, 13, 11, true);
const back = () => paint([...BACK_HEAD, ...BACK_BODY], TAIL_FLOOR, 0, 15, true);
const side = () => paint(shiftRight(SIDE, 0), SIDE_TAIL, 0, 8, true);
const RAISED = ['OO', 'PO', 'FO', 'FO', 'FO', 'O.']; // a paw held up beside the head (right side)
const MARKER = ['DO', 'PO', 'FO', 'FO', 'FO', 'O.'];
const HANDSET = ['DD', 'DO', 'DD'];
const BOOK = ['OOOOOOOOOOOO', 'PWWLWWOWWLWP', 'OWLLWWOWLLWO', 'OOOOOOOOOOOO'];

/** One sheet: animation name → frames, each a list of string-art rows. */
export type Sheet = Record<string, string[][]>;

const E: Sheet = {
  idle: [PAWS_DOWN(front()), PAWS_DOWN(front(TAIL_FLICK))],
  walk: WALK_LEGS.map((legs, i) =>
    paint([...WALK_TOP, ...legs], WALK_TAIL[i], 0, 2, true),
  ),
  type: [pawsUp(front(), 'left'), pawsUp(front(), 'right')],
  read: [
    paint(PAWS_DOWN(front()), BOOK, 2, 12),
    paint(
      PAWS_DOWN(front(TAIL_FLICK)),
      BOOK.map((r) => r.replace('WWLW', 'WLWW')),
      2,
      12,
    ),
  ],
  wait: [
    paint(PAWS_DOWN(front()), RAISED, 15, 3),
    paint(PAWS_DOWN(front()), RAISED, 15, 2),
  ],
  phone: [paint(paint(PAWS_DOWN(front()), HANDSET, 0, 5), ['P'], 1, 8)],
  write: [
    paint(PAWS_DOWN(front()), MARKER, 15, 2),
    paint(PAWS_DOWN(front()), MARKER, 15, 3),
  ],
  sit: [LOAF],
  back: [back(), paint(back(), ['O', 'T'], 1, 14)],
  backType: [paint(back(), ['OP'], 1, 13), paint(back(), ['PO'], 13, 13)],
  backWait: [paint(back(), RAISED, 15, 3), paint(back(), RAISED, 15, 2)],
  backPhone: [paint(back(), HANDSET, 0, 5)],
  side: [PAWS_DOWN(side()), PAWS_DOWN(paint(side(), ['.O', 'OT'], 0, 7, true))],
  sideType: [
    paint(PAWS_DOWN(side()), ['P'], 13, 13),
    paint(PAWS_DOWN(side()), ['P'], 13, 14),
  ],
  sideRead: [
    paint(PAWS_DOWN(side()), ['OWW', 'PWL', 'OWW'], 11, 10),
    paint(PAWS_DOWN(side()), ['OWW', 'PLW', 'OWW'], 11, 10),
  ],
  sideWait: [
    paint(PAWS_DOWN(side()), ['.O', 'OP', 'OF', 'OF', '.O'], 13, 0),
    paint(PAWS_DOWN(side()), ['.O', 'OP', 'OF', 'OF', '.O'], 13, 1),
  ],
  sidePhone: [
    paint(PAWS_DOWN(side()), ['D', 'D', 'P'], 12, 4),
    paint(
      paint(PAWS_DOWN(side()), ['D', 'D', 'P'], 12, 4),
      ['.O', 'OT'],
      0,
      7,
      true,
    ),
  ],
};
E.bat = [E.idle[0], E.wait[0]]; // paw down, paw up: batting at a toy
E.scratch = [
  SCRATCH,
  SCRATCH.map((r, i) =>
    i === 7 ? '..OFFFFFFO..' : i === 9 ? '.OFSFFCCCOPP' : r,
  ),
];

// ---- kitten -------------------------------------------------------------------------------------------------------
const K_HEAD = [
  '.O........O.',
  '.OO......OO.',
  '.OAOOOOOOAO.',
  'OFFFSSSSFFFO',
  'OFWEFFFFWEFO',
  'OFEEFFFFEEFO',
  'ROFFUNNUFFOR',
  '.ROFUUUUFOR.',
];
const K_BODY = ['..OFCCCCFO..', '..OFCCCCFO..', '..OppFFppO..', '..OOOOOOOO..'];
const K_BACK_HEAD = [
  '.O........O.',
  '.OO......OO.',
  '.OFOOOOOOFO.',
  'OFFFSSSSFFFO',
  'OFFFFSSFFFFO',
  'OFFFSSSSFFFO',
  'ROFFFFFFFFOR',
  '.ROFFFFFFOR.',
];
const K_BACK_BODY = [
  '..OFFSSFFO..',
  '..OFFFFFFO..',
  '..OFFFFFFO..',
  '..OOOOOOOO..',
];
const K_TAIL = ['.OO', 'OTO', 'OTO', 'TO.'];
const K_WALK_TOP = [
  '..........O..O..',
  '.........OAOOAO.',
  'OO......OFFFFWEO',
  'OTO.OOOOFFFFFEEO',
  '.OTOFSFFSFFFFUUN',
  '..OFFFFFFFFFFUO.',
  '..OCCCCCCCFFFO..',
];
const K_WALK_LEGS = [
  ['.OFO......OFO...', '.OPO......OPO...'],
  ['...OFO..OFO.....', '...OPO..OPO.....'],
];
const K_LOAF = [
  '.........O..O.',
  '........OAOOAO',
  '...OOOOOFFFWEO',
  '..OFSFFSFFFEEO',
  '.OFFFFFFFFFUUN',
  'OTFCCCCCCCPPO.',
  '.OOOOOOOOOOOO.',
];
const kFront = (tail = K_TAIL) =>
  paint([...K_HEAD, ...K_BODY], tail, 9, 7, true);
const kDown = (rows: string[]) => rows.map((r) => r.replace(/p/g, 'P'));
const kBack = () =>
  paint([...K_BACK_HEAD, ...K_BACK_BODY], ['.OOO', 'OTTT', '.OOO'], 0, 9, true);
const K_RAISED = ['OO', 'PO', 'FO', 'O.'];

const A = {
  idle: [kDown(kFront()), kDown(kFront(['OO.', 'OTO', '.OTO', 'TO.']))],
  walk: K_WALK_LEGS.map((legs) => [...K_WALK_TOP, ...legs]),
  type: [3, 7].map((x) =>
    kDown(paint(paint(kFront(), ['FF'], x, 10), ['PP'], x, 8)),
  ),
  read: [paint(kDown(kFront()), ['OOOOOOOO', 'PWWLOWLP', 'OOOOOOOO'], 2, 8)],
  wait: [
    paint(kDown(kFront()), K_RAISED, 11, 3),
    paint(kDown(kFront()), K_RAISED, 11, 2),
  ],
  phone: [paint(kDown(kFront()), ['DD', 'DO', 'DD'], 0, 3)],
  write: [
    paint(kDown(kFront()), ['DO', 'PO', 'FO', 'O.'], 11, 2),
    paint(kDown(kFront()), ['DO', 'PO', 'FO', 'O.'], 11, 3),
  ],
  sit: [K_LOAF],
  back: [kBack()],
  backType: [paint(kBack(), ['OP'], 1, 8), paint(kBack(), ['PO'], 9, 8)],
};

// ---- receptionist robot ----------------------------------------------------------------------------------------------
// Same keys, robot colors (see RECEPTIONIST_PAL): F plating, S bolts / trim, U face screen, E eyes, N smile, C chest
// panel, L its lights, P hands, T antenna light. Its lower body hides behind the lobby counter.
const ROBOT = [
  '.......T.......',
  '.......A.......',
  '...OOOOAOOOO...',
  '..OFFFFFFFFFO..',
  '.OFUUUUUUUUUFO.',
  'OSFUEEUUUEEUFSO',
  'OSFUEEUUUEEUFSO',
  '.OFUUNNNNNUUFO.',
  '..OFFFFFFFFFO..',
  '...OOOSSSOOO...',
  '..OFFFFFFFFFO..',
  'POFFCCCCCCCFFOP',
  'POFFCLCDCLCFFOP',
  '.OFFCCCCCCCFFO.',
  '.OFFFFFFFFFFFO.',
  '.OOOOOOOOOOOOO.',
];
const ROBOT_ARMLESS = ROBOT.map((r, i) =>
  i === 11 || i === 12 ? r.slice(0, 14) + '.' : r,
); // right hand off the side
const WAVE = ['OO', 'PO', 'PO', 'PO', 'O.']; // right arm up beside the head
const R = {
  idle: [ROBOT, ROBOT.map((r) => r.replace('T', 'S'))], // the antenna light blinks
  wait: [paint(ROBOT_ARMLESS, WAVE, 15, 6), paint(ROBOT_ARMLESS, WAVE, 15, 5)], // waving at someone coming in
};

export const SHEETS: Record<string, Sheet> = {
  employee: E,
  assistant: A,
  robot: R,
};
