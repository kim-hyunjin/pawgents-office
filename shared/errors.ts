// Errors as values that cross module (and process) boundaries: a message, plus a machine-readable code.

/** Message of a caught value (errors from child_process carry stderr and code too). */
export const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** The string `code` of a caught value, if it has one. */
export const errCode = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
};

/** An Error carrying a machine-readable `code` (mapped to an HTTP status by server/http.ts errorStatus). */
export const codedError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });
