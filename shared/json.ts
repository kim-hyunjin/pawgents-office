/** JSON.parse that answers null for text that isn't JSON. */
export function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
