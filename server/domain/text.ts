// What the server keeps of an assistant's text. The generic text helpers are in shared/text.ts.
import { truncate } from '../../shared/text.ts';
import { MAX_REPLY_CHARS } from '../config.ts';

/** Assistant text kept verbatim (markdown intact) for the reply dialog. */
export function replyText(s?: unknown) {
  return truncate(String(s ?? '').trim(), MAX_REPLY_CHARS);
}
