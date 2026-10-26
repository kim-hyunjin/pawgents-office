import path from 'node:path';

/** The hook script: installed into Claude settings, and run by headless claude as its permission hook. */
export const SEND_SCRIPT = path.resolve(
  import.meta.dirname,
  '../../hooks/send.ts',
);

/** The server's entry point, started in the background by shared/node/ensure.ts. */
export const SERVER_SCRIPT = path.resolve(
  import.meta.dirname,
  '../../server/index.ts',
);
