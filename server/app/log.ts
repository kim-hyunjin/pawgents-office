// How the activity log writes: to the console by default, and how it names sessions and quotes user text.
import type { Session } from '../types.ts';
import { oneLine, truncate } from '../util.ts';
import type { Logger } from './ports.ts';

export const consoleLogger: Logger = { info: (line) => console.log(line) };

/** `name (abcd1234)`: how the server log names a session. */
export const label = (s: Session) => `${s.name} (${s.id.slice(0, 8)})`;
/** One short line of user text for the server log. */
export const preview = (text: string) => truncate(oneLine(text), 80);
