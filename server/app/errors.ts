// A use case saying no, without knowing HTTP: why (`refusal`) and, for the browser to branch on, a `code`.
// server/http.ts turns it into a status; errors from the backends carry their own codes (shared/errors.ts).

/** The messages several requests answer with. */
export const BAD_REQUEST = '잘못된 요청입니다.';
export const UNKNOWN_MODE = '알 수 없는 권한 모드입니다.';

export type Refusal = 'invalid' | 'not_found' | 'conflict' | 'failed';

export class AppError extends Error {
  refusal: Refusal;
  code?: string;
  constructor(message: string, refusal: Refusal, code?: string) {
    super(message);
    this.refusal = refusal;
    if (code !== undefined) this.code = code;
  }
}

/** The request asks for something that can't be (bad input, an unknown name). */
export const invalid = (message: string) => new AppError(message, 'invalid');
/** What the request names isn't there. */
export const notFound = (message: string) => new AppError(message, 'not_found');
/** Not now: the session's state is in the way (`code` tells the browser which way). */
export const conflict = (message: string, code: string) =>
  new AppError(message, 'conflict', code);
/** Every attempt failed downstream (Orca, git, claude). */
export const failed = (message: string) => new AppError(message, 'failed');
