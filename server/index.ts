// The server's entry point (`bun server/index.ts`, started by shared/node/ensure.ts): runs server/main.ts.
// Importing it runs nothing; createApp is re-exported for the tests.
import { createApp } from './http/app.ts';
import { createServerRuntime } from './main.ts';

export { createApp };

if (import.meta.main) await createServerRuntime().start();
