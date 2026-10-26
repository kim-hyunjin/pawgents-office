import fs from 'node:fs';
import path from 'node:path';
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { WEB_DIR } from './config.ts';
import { decode } from './util.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** 200 + headers (+ Content-Length when `size` is known), then stream `file`; a read error just drops the connection. */
export function sendFile(res: ServerResponse, file: string, size: number | null, headers: OutgoingHttpHeaders) {
  res.writeHead(200, size == null ? headers : { ...headers, 'Content-Length': size });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });
const transpiled = new Map<string, { mtimeMs: number; code: string }>();

/** The browser imports the .ts modules directly: strip types per request (cached until the file changes), no build step. */
function sendTranspiled(res: ServerResponse, file: string, mtimeMs: number): void {
  let hit = transpiled.get(file);
  if (!hit || hit.mtimeMs !== mtimeMs) {
    try { hit = { mtimeMs, code: transpiler.transformSync(fs.readFileSync(file, 'utf8')) }; } catch (e) {
      console.error('[static]', file, e); res.writeHead(500); res.end(); return;
    }
    transpiled.set(file, hit);
  }
  res.writeHead(200, { 'Content-Type': MIME['.ts'], 'Cache-Control': 'no-cache' });
  res.end(hit.code);
}

export function serveStatic(urlPath: string, res: ServerResponse) {
  let rel = decode(urlPath.replace(/^\/web\//, '/'));
  if (rel === null) return false; // malformed %-escape names no file we have → 404
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); res.end('forbidden'); return true; }
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  if (file.endsWith('.ts')) { sendTranspiled(res, file, st.mtimeMs); return true; }
  sendFile(res, file, st.size, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  return true;
}
