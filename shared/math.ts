// Small number helpers, safe anywhere (browser and server).

/** v kept within [a, b]. */
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
