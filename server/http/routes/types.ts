// A route: [method, path or RegExp, handler]. index.ts (the server) matches in order; RegExp groups arrive as
// `params`, already %-decoded. Each handler parses the request, calls a use case (server/app/) and replies.
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RouteCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
}
export type Route = [
  method: string,
  path: string | RegExp,
  handler: (ctx: RouteCtx) => unknown,
];
