import type { IncomingMessage, ServerResponse } from 'node:http';
import { SSE_HEARTBEAT_MS } from './config.ts';

export class Sse {
  clients: Set<ServerResponse>;
  timer: ReturnType<typeof setInterval>;

  constructor() {
    this.clients = new Set();
    this.timer = setInterval(() => this.raw(': ping\n\n'), SSE_HEARTBEAT_MS);
    this.timer.unref();
  }
  add(req: IncomingMessage, res: ServerResponse, initial?: { type: string; data: unknown }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    if (initial) res.write(format(initial.type, initial.data));
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('error', drop);
  }
  send(type: string, data: unknown) { this.raw(format(type, data)); }
  raw(chunk: string) {
    for (const res of this.clients) {
      try { res.write(chunk); } catch { this.clients.delete(res); }
    }
  }
}

function format(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
