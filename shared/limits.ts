// Limits shared by the server and the browser, so a dialog pre-checks exactly what the server will reject (the
// server still checks everything itself). Pure ESM with no imports: the browser loads it and the server imports it.
export const MAX_NAME_CHARS = 30; // office, room and skin names
export const isName = (s: unknown) =>
  typeof s === 'string' && s.length >= 1 && s.length <= MAX_NAME_CHARS;
export const MAX_HIRES = 5; // employees per "새 직원" request
export const WORKTREE_NAME_RE = /^[A-Za-z0-9][\w.-]{0,59}$/;

// Sprite sheet rules (see README "스킨"): equal cells, one row per animation (sprites.js SKIN_ROWS), up to MAX_SKIN_ROWS rows.
export const MAX_SKIN_BYTES = 512 * 1024; // decoded PNG; its base64 still fits in the server's MAX_BODY_BYTES
export const MAX_SKIN_ROWS = 12,
  MAX_SKIN_COLS = 16,
  MIN_CELL = 4,
  MAX_CELL = 64;
export const isCell = (n: number) =>
  Number.isInteger(n) && n >= MIN_CELL && n <= MAX_CELL;

/** Grid problems of a w×h sheet cut into cellW×cellH cells, or null. Shared so the dialog pre-checks exactly what the server rejects. */
export function skinGridError(
  w: number,
  h: number,
  cellW: number,
  cellH: number,
): string | null {
  if (w % cellW || h % cellH)
    return `이미지 크기(${w}×${h})가 칸 크기(${cellW}×${cellH})로 나누어떨어지지 않아요.`;
  const rows = h / cellH,
    cols = w / cellW;
  if (rows < 2 || rows > MAX_SKIN_ROWS)
    return `줄 수는 2–${MAX_SKIN_ROWS}줄이어야 해요(지금 ${rows}줄).`;
  if (cols > MAX_SKIN_COLS)
    return `한 줄은 ${MAX_SKIN_COLS}칸까지예요(지금 ${cols}칸).`;
  return null;
}
export const MAX_REPLY_CHARS = 200_000; // full markdown reply kept per entity (served on demand, not over SSE)
