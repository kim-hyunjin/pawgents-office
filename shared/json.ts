/** JSON.parse that answers null for text that isn't JSON. */
export function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A JSON object (or array): what a reader looks into before trusting any field. */
export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null;
/** `x[key]` if `x` is an object, else undefined. */
export const field = (x: unknown, key: string): unknown =>
  isRecord(x) ? x[key] : undefined;
