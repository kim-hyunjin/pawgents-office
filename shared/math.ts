// Small number helpers, safe anywhere (browser and server).

/** xs[i mod length] for i >= 0: a non-empty list read round and round (always an element). */
export const cyclic = <T>(xs: readonly [T, ...T[]], i: number): T =>
  xs[i % xs.length] ?? xs[0];

/** v kept within [a, b]. */
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
