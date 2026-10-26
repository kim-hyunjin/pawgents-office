// The HTTP API as a table: [method, path or RegExp, handler]. index.ts matches in order; RegExp groups arrive
// as `params`, already %-decoded. Anything unmatched falls through to static files (GET) or 404.
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type {
  BackendsReply,
  DiffReply,
  LaunchReply,
  LogReply,
  ReplyReply,
  WorktreesReply,
} from '../shared/api.ts';
import { errMessage } from '../shared/errors.ts';
import { safeJsonParse } from '../shared/json.ts';
import {
  cloneOffice,
  DEFAULT_OFFICE,
  normalize,
  validate,
} from '../shared/layout.ts';
import {
  isCell,
  isName,
  MAX_CELL,
  MAX_HIRES,
  MAX_NAME_CHARS,
  MIN_CELL,
  WORKTREE_NAME_RE,
} from '../shared/limits.ts';
import { isCatFamily } from '../shared/model.ts';
import { MODEL_RE, PERMISSION_MODES } from '../shared/permission.ts';
import type { Backend } from './app/ports.ts';
import { addWorktree, samePath, worktreesAt } from './backends/git.ts';
import type { HeadlessBackend } from './backends/headless.ts';
import type { BackendRegistry } from './backends/index.ts';
import type { OrcaBackend } from './backends/orca.ts';
import { MAX_BODY_BYTES, MAX_PROMPT_CHARS } from './config.ts';
import { fileDiff } from './diff.ts';
import { scheduleFileSync } from './files.ts';
import {
  backendError,
  findSession,
  holdForDecision,
  isOwnHost,
  json,
  notFound,
  readBody,
  readJson,
  tooLarge,
} from './http.ts';
import { applyHook } from './reducer.ts';
import { hasSkin, skinError } from './skins.ts';
import type { Sse } from './sse.ts';
import { sendFile } from './static.ts';
import type { Store } from './store.ts';
import { BREED_KEY, DEFAULT_OFFICE_ID } from './store.ts';
import type { HookEvent, Session, SysError } from './types.ts';
import { isDir, oneLine, truncate } from './util.ts';

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

const BAD_REQUEST = '잘못된 요청입니다.';
const SESSION_GONE = '세션이 없거나 종료되었습니다.';
const UNKNOWN_MODE = '알 수 없는 권한 모드입니다.';
const UNKNOWN_BRANCH = '기준 워크트리의 브랜치를 알 수 없습니다.';
const PROMPT_WAITING =
  '권한 승인·질문 응답을 기다리는 중입니다. 터미널에서 먼저 답해주세요.';

/** `name (abcd1234)`: how the server log names a session. */
const label = (s: Session) => `${s.name} (${s.id.slice(0, 8)})`;
/** One short line of user text for the server log. */
const preview = (text: string) => truncate(oneLine(text), 80);
/** The worktree a hire gets: `name` alone, or `name-1`, `name-2`, … when hiring several. */
const hireName = (name: string, count: number, i: number) =>
  count > 1 ? `${name}-${i}` : name;

/** The backend driving `s`, or null after answering 409 (a headless session whose runner isn't connected). */
function backendOrDetached(
  backends: BackendRegistry,
  res: ServerResponse,
  s: Session,
): Backend | null {
  try {
    return backends.driverOf(s);
  } catch (e) {
    backendError(res, e);
    return null;
  }
}

/** `[hook] Event Tool · target  session (id) [agent id] → state` */
function logHook(s: Session, ev: HookEvent) {
  const ent = ev.agent_id ? s.subagents.get(String(ev.agent_id)) : s;
  const tool = ev.tool_name
    ? ` ${ev.tool_name}${ent?.currentTool?.target ? ' · ' + ent.currentTool.target : ''}`
    : '';
  const agent = ev.agent_id
    ? ` [agent ${String(ev.agent_id).slice(0, 8)}]`
    : '';
  console.log(
    `[hook] ${ev.hook_event_name}${tool}  ${label(s)}${agent} → ${ent?.state ?? s.state}`,
  );
}

/** Orca: one hire at a time (Orca creates checkouts / tabs sequentially anyway), a failure doesn't hide the rest. */
async function launchOrca(
  orca: OrcaBackend,
  res: ServerResponse,
  {
    worktreeId,
    prompt,
    model,
    count,
    name,
  }: {
    worktreeId: string;
    prompt: string;
    model: string;
    count: number;
    name: string | null;
  },
) {
  if (!worktreeId) {
    json(res, 400, { error: BAD_REQUEST });
    return;
  }
  const base = (await orca.listWorktrees()).find((w) => w.id === worktreeId);
  if (!base) {
    json(res, 400, { error: '알 수 없는 워크트리입니다.' });
    return;
  }
  if (name !== null && !base.branch && !base.head) {
    json(res, 400, { error: UNKNOWN_BRANCH });
    return;
  }
  const started: string[] = [],
    errors: string[] = [];
  for (let i = 1; i <= count; i++) {
    const wtName = name === null ? null : hireName(name, count, i);
    try {
      if (wtName)
        await orca.createWorktreeWithClaude({
          base,
          name: wtName,
          prompt,
          model,
        });
      else await orca.launchClaude({ worktreeId, prompt, model });
      started.push(wtName || base.path);
      console.log(
        `[web] launch claude in ${wtName ? `new worktree ${wtName} (from ${base.branch || base.head})` : base.path}${prompt ? ': ' + preview(prompt) : ''}`,
      );
    } catch (e) {
      errors.push(`${wtName || `#${i}`}: ${errMessage(e)}`);
    }
  }
  if (!started.length) {
    json(res, 502, { error: errors.join('\n') });
    return;
  }
  json(res, 200, {
    ok: true,
    started: started.length,
    errors,
    sessions: [],
  } satisfies LaunchReply);
}

/** Headless: worktrees (if any) are made one by one (git locks the repo), then every claude starts in parallel. */
async function launchHeadless(
  headless: HeadlessBackend,
  res: ServerResponse,
  {
    cwd,
    prompt,
    model,
    count,
    name,
    permissionMode,
  }: {
    cwd: unknown;
    prompt: string;
    model: string;
    count: number;
    name: string | null;
    permissionMode: string;
  },
) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !isDir(cwd)) {
    json(res, 400, { error: '작업 폴더가 없습니다.' });
    return;
  }
  if (!PERMISSION_MODES.includes(permissionMode)) {
    json(res, 400, { error: UNKNOWN_MODE });
    return;
  }
  const p = await headless.probe();
  if (!p.available) {
    json(res, 409, { error: p.reason, code: 'headless_unavailable' });
    return;
  }
  const dirs: string[] = [],
    errors: string[] = [];
  if (name === null) for (let i = 0; i < count; i++) dirs.push(cwd);
  else {
    // git's own list gives the main worktree's real-case path (repo keys are lowercased on Windows)
    const ws = await worktreesAt(cwd),
      sel = ws.find((w) => samePath(w.path, cwd));
    if (!sel) {
      json(res, 400, { error: '선택한 폴더가 git 워크트리가 아닙니다.' });
      return;
    }
    if (!sel.branch && !sel.head) {
      json(res, 400, { error: UNKNOWN_BRANCH });
      return;
    }
    const repoRoot = ws[0]?.isMain ? ws[0].path : sel.path;
    for (let i = 1; i <= count; i++) {
      const wtName = hireName(name, count, i);
      try {
        dirs.push(
          (
            await addWorktree({
              repoRoot,
              name: wtName,
              base: sel.branch || sel.head,
            })
          ).path,
        );
      } catch (e) {
        errors.push(`${wtName}: ${errMessage(e)}`);
      }
    }
  }
  const results = await Promise.allSettled(
    dirs.map((dir) =>
      headless.launch({ cwd: dir, prompt, model, permissionMode }),
    ),
  );
  const sessions: (string | undefined)[] = []; // undefined: gone again by the time launch returned
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sessions.push(r.value?.id);
      console.log(
        `[web] launch claude (headless) in ${dirs[i]}${prompt ? ': ' + preview(prompt) : ''}`,
      );
    } else
      errors.push(
        `${path.basename(dirs[i])}: ${r.reason?.message || r.reason}`,
      );
  });
  if (!sessions.length) {
    json(res, 502, { error: errors.join('\n') || '시작하지 못했습니다.' });
    return;
  }
  json(res, 200, {
    ok: true,
    started: sessions.length,
    errors,
    sessions,
  } satisfies LaunchReply);
}

export function makeRoutes({
  store,
  sse,
  backends,
}: {
  store: Store;
  sse: Sse;
  backends: BackendRegistry;
}): Route[] {
  // The office routes read the body first, so 403 / 413 / 400 win over a 404 for an unknown office.
  const officeCtx = async ({ req, res, params: [id] }: RouteCtx) => {
    const office = store.office(id);
    const data = await readJson(req, res);
    if (!data) return null;
    if (!office) {
      json(res, 404, { error: '사무실이 없습니다.' });
      return null;
    }
    return { id, office, data };
  };

  // newWorktree: branch a fresh worktree off the selected one per hire, named name / name-1, name-2, …
  const launch = async (res: ServerResponse, data: Record<string, any>) => {
    const backend = String(data.backend || ''),
      prompt = String(data.prompt ?? '').trim(),
      model = String(data.model || '').trim();
    const count = Number(data.count ?? 1),
      name = data.newWorktree
        ? String(data.newWorktree.name || '').trim()
        : null;
    if (
      !['orca', 'headless'].includes(backend) ||
      prompt.length > MAX_PROMPT_CHARS ||
      (model && !MODEL_RE.test(model)) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_HIRES ||
      (name !== null && !WORKTREE_NAME_RE.test(name))
    ) {
      json(res, 400, { error: BAD_REQUEST });
      return;
    }
    try {
      if (backend === 'orca')
        await launchOrca(backends.byId.orca, res, {
          worktreeId: String(data.worktreeId || ''),
          prompt,
          model,
          count,
          name,
        });
      else
        await launchHeadless(backends.byId.headless, res, {
          cwd: data.cwd,
          prompt,
          model,
          count,
          name,
          permissionMode:
            data.permissionMode == null || data.permissionMode === ''
              ? 'default'
              : String(data.permissionMode),
        });
    } catch (e) {
      backendError(res, e);
    }
  };

  return [
    [
      'POST',
      '/hook',
      async ({ req, res }) => {
        if (req.headers.origin) {
          res.writeHead(403);
          res.end();
          return;
        } // hooks never send Origin; browsers always do
        let body = '';
        try {
          body = await readBody(req, MAX_BODY_BYTES);
        } catch {
          tooLarge(req, res);
          return;
        }
        const ev = safeJsonParse(body);
        const s = ev ? applyHook(store, ev) : null;
        if (s && ev) logHook(s, ev);
        // a --decide hook: hold the request open until the browser answers, if the session's backend parks requests
        const parked =
          s &&
          ev.await_decision === true &&
          ev.hook_event_name === 'PermissionRequest' &&
          !ev.agent_id
            ? backends.ownerOf(s).parkPermission(s, ev)
            : null;
        if (parked) {
          void holdForDecision(res, parked);
          return;
        }
        res.writeHead(204);
        res.end();
      },
    ],
    [
      'GET',
      '/events',
      ({ req, res }) =>
        sse.add(req, res, { type: 'snapshot', data: store.snapshot() }),
    ],
    ['GET', '/state', ({ res }) => json(res, 200, store.snapshot())],
    [
      'GET',
      '/backends',
      async ({ res }) =>
        json(res, 200, (await backends.status()) satisfies BackendsReply),
    ],
    [
      'GET',
      '/healthz',
      ({ res }) => {
        res.writeHead(200);
        res.end('ok');
      },
    ],
    [
      'GET',
      /^\/sessions\/([^/]+)\/log$/,
      ({ res, params: [id] }) => {
        const s = findSession(store, res, id);
        if (!s) return;
        if (!s.ended) scheduleFileSync(store, s); // the panel just opened: freshen its worked files
        json(res, 200, { id: s.id, log: s.log.toArray() } satisfies LogReply);
      },
    ],
    [
      'GET',
      /^\/sessions\/([^/]+)\/reply$/,
      ({ res, url, params: [id] }) => {
        const s = findSession(store, res, id);
        if (!s) return;
        const agentId = url.searchParams.get('agent');
        const ent = agentId ? s.subagents.get(agentId) : s;
        if (!ent) {
          json(res, 404, { error: 'not found' });
          return;
        }
        json(res, 200, {
          id: s.id,
          agentId,
          text: ent.replyText || ent.lastText || '',
          at: ent.lastTextAt,
        } satisfies ReplyReply);
      },
    ],
    [
      'GET',
      /^\/sessions\/([^/]+)\/diff$/,
      async ({ req, res, url, params: [id] }) => {
        if (!isOwnHost(req)) {
          json(res, 403, { error: 'forbidden' });
          return;
        } // whole files go out here: no DNS rebinding
        const s = findSession(store, res, id);
        if (!s) return;
        const file = String(url.searchParams.get('file') || '');
        const f = file ? s.files.get(path.normalize(file)) : null; // only files this session's tools touched
        if (!f) {
          json(res, 404, { error: '이 세션이 작업한 파일이 아닙니다.' });
          return;
        }
        try {
          const d = await fileDiff(s.cwd, f.path, {
            since: s.startedAt - 60_000,
          });
          json(res, 200, { file: f.path, ...d } satisfies DiffReply);
        } catch (e) {
          const { code, message } = e as SysError;
          json(
            res,
            code === 'not_repo' ? 409 : code === 'outside' ? 400 : 502,
            { error: message, code },
          );
        }
      },
    ],
    [
      'POST',
      /^\/sessions\/([^/]+)\/prompt$/,
      async ({ req, res, params: [id] }) => {
        const data = await readJson(req, res);
        if (!data) return;
        const s = findSession(store, res, id, {
          live: true,
          msg: SESSION_GONE,
        });
        if (!s) return;
        const text = String(data.text ?? '').trim();
        if (!text || text.length > MAX_PROMPT_CHARS) {
          json(res, 400, {
            error: `지시는 1–${MAX_PROMPT_CHARS}자여야 합니다.`,
          });
          return;
        }
        const b = backendOrDetached(backends, res, s);
        if (!b) return;
        if (!b.canPromptWhile(s.state)) {
          json(res, 409, { error: PROMPT_WAITING, code: 'waiting' });
          return;
        }
        try {
          const r = await b.sendPrompt(s, text);
          console.log(`[web] prompt → ${label(s)}: ${preview(text)}`);
          store.emitSession(s);
          json(res, 200, { ok: true, accepted: r?.accepted ?? true });
        } catch (e) {
          backendError(res, e);
        }
      },
    ],
    [
      'POST',
      /^\/sessions\/([^/]+)\/close$/,
      async ({ req, res, params: [id] }) => {
        const data = await readJson(req, res);
        if (!data) return;
        const s = findSession(store, res, id, {
          live: true,
          msg: '세션이 없거나 이미 종료되었습니다.',
        });
        if (!s) return;
        const force = data.force === true,
          b = backendOrDetached(backends, res, s);
        if (!b) return;
        // `/exit` is only safe at an idle prompt; the client re-asks with force otherwise.
        if (!force && s.state !== 'idle') {
          json(res, 409, {
            error:
              '작업 중이거나 응답 대기 중이라 /exit 를 보낼 수 없습니다. 강제 종료를 쓰세요.',
            code: 'busy',
          });
          return;
        }
        try {
          await b.close(s, { force });
          console.log(`[web] close${force ? ' (force)' : ''} → ${label(s)}`);
          json(res, 200, { ok: true });
        } catch (e) {
          backendError(res, e);
        }
      },
    ],
    [
      'POST',
      /^\/sessions\/([^/]+)\/mode$/,
      async ({ req, res, params: [id] }) => {
        const data = await readJson(req, res);
        if (!data) return;
        const mode = String(data.mode ?? '');
        if (!PERMISSION_MODES.includes(mode)) {
          json(res, 400, { error: UNKNOWN_MODE });
          return;
        }
        const s = findSession(store, res, id, {
          live: true,
          msg: SESSION_GONE,
        });
        if (!s) return;
        const b = backendOrDetached(backends, res, s);
        if (!b) return;
        try {
          await b.setMode(s, mode);
          console.log(`[web] mode ${mode} → ${label(s)}`);
          store.emitSession(s);
          json(res, 200, { ok: true, mode: s.permissionMode });
        } catch (e) {
          backendError(res, e);
        }
      },
    ],
    [
      'POST',
      /^\/sessions\/([^/]+)\/permission$/,
      async ({ req, res, params: [id] }) => {
        const data = await readJson(req, res);
        if (!data) return;
        if (typeof data.id !== 'string' || typeof data.allow !== 'boolean') {
          json(res, 400, { error: BAD_REQUEST });
          return;
        }
        const s = findSession(store, res, id, {
          live: true,
          msg: SESSION_GONE,
        });
        if (!s) return;
        // not driverOf: a headless request outlives its runner's connection (and answers 'stale' once it's gone)
        let what: string;
        try {
          what = await backends
            .ownerOf(s)
            .answerPermission(s, data.id, data.allow);
        } catch (e) {
          backendError(res, e);
          return;
        }
        console.log(
          `[web] permission ${data.allow ? 'allow' : 'deny'} ${what} → ${label(s)}`,
        );
        json(res, 200, { ok: true });
      },
    ],
    [
      'GET',
      '/worktrees',
      async ({ res, url }) => {
        const id =
          url.searchParams.get('backend') || (await backends.status()).default;
        const b = id ? backends.find(id) : null;
        try {
          if (b)
            json(res, 200, {
              worktrees: await b.listWorktrees(),
            } satisfies WorktreesReply);
          else json(res, 400, { error: '알 수 없는 백엔드입니다.' });
        } catch (e) {
          backendError(res, e);
        }
      },
    ],
    [
      'POST',
      '/settings/together',
      async ({ req, res }) => {
        const data = await readJson(req, res);
        if (!data) return;
        const id = data.officeId == null ? null : String(data.officeId);
        if (id !== null && !store.office(id)) {
          json(res, 404, { error: '사무실이 없습니다.' });
          return;
        }
        store.setTogether(id);
        console.log(
          `[web] ${id ? `everyone works in ${store.office(id)!.name}` : 'back to one office per repo'}`,
        );
        json(res, 200, { ok: true });
      },
    ],
    [
      'POST',
      /^\/offices\/([^/]+)\/layout$/,
      async (ctx) => {
        const o = await officeCtx(ctx);
        if (!o) return;
        const layout = normalize(o.data.layout),
          errs = validate(layout);
        if (errs.length) {
          json(ctx.res, 400, { error: errs.map((e) => e.msg).join(' / ') });
          return;
        }
        store.setLayout(o.id, layout!);
        console.log(`[web] layout saved: ${o.office.name}`);
        json(ctx.res, 200, { ok: true });
      },
    ],
    [
      'POST',
      /^\/offices\/([^/]+)\/reset$/,
      async (ctx) => {
        const o = await officeCtx(ctx);
        if (!o) return;
        store.setLayout(o.id, cloneOffice(DEFAULT_OFFICE));
        json(ctx.res, 200, { ok: true });
      },
    ],
    [
      'POST',
      /^\/offices\/([^/]+)$/,
      async (ctx) => {
        const o = await officeCtx(ctx);
        if (!o) return;
        const name = String(o.data.name ?? '').trim();
        if (!isName(name)) {
          json(ctx.res, 400, {
            error: `사무실 이름은 1–${MAX_NAME_CHARS}자여야 합니다.`,
          });
          return;
        }
        store.renameOffice(o.id, name);
        json(ctx.res, 200, { ok: true });
      },
    ],
    [
      'DELETE',
      /^\/offices\/([^/]+)$/,
      async (ctx) => {
        const o = await officeCtx(ctx);
        if (!o) return;
        if (o.id === DEFAULT_OFFICE_ID) {
          json(ctx.res, 400, { error: '기본 사무실은 닫을 수 없습니다.' });
          return;
        }
        store.deleteOffice(o.id);
        console.log(`[web] office closed: ${o.office.name}`);
        json(ctx.res, 200, { ok: true });
      },
    ],
    [
      'POST',
      '/settings/cats',
      async ({ req, res }) => {
        const data = await readJson(req, res);
        if (!data) return;
        const fam = String(data.family || ''),
          breed = data.breed == null ? null : String(data.breed);
        if (
          !isCatFamily(fam) ||
          (breed !== null && (!BREED_KEY.test(breed) || !store.hasBreed(breed)))
        ) {
          json(res, 400, { error: BAD_REQUEST });
          return;
        }
        store.setCat(fam, breed);
        json(res, 200, { ok: true, cats: store.cats });
      },
    ],
    [
      'POST',
      '/skins',
      async ({ req, res }) => {
        const data = await readJson(req, res);
        if (!data) return;
        const name = String(data.name ?? '').trim(),
          cellW = Number(data.cellW),
          cellH = Number(data.cellH);
        if (!isName(name)) {
          json(res, 400, {
            error: `스킨 이름은 1–${MAX_NAME_CHARS}자여야 합니다.`,
          });
          return;
        }
        if (!isCell(cellW) || !isCell(cellH)) {
          json(res, 400, {
            error: `칸 크기는 ${MIN_CELL}–${MAX_CELL}px이어야 합니다.`,
          });
          return;
        }
        const png = Buffer.from(
          String(data.png ?? '').replace(/^data:image\/png;base64,/, ''),
          'base64',
        );
        const err = skinError(png, cellW, cellH);
        if (err) {
          json(res, 400, { error: err });
          return;
        }
        const skin = store.addSkin({ name, cellW, cellH }, png);
        console.log(`[web] skin uploaded: ${name} (${skin.id})`);
        json(res, 200, { ok: true, skin });
      },
    ],
    [
      'GET',
      /^\/skins\/([a-z0-9]{10})\.png$/,
      ({ res, params: [id] }) => {
        const file = hasSkin(store.skins, id) ? store.skinFile(id) : null;
        if (!file || !fs.existsSync(file)) {
          notFound(res);
          return;
        }
        // ids are never reused, so the image under one can be cached for good
        sendFile(res, file, null, {
          'Content-Type': 'image/png',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'max-age=31536000, immutable',
        });
      },
    ],
    [
      'POST',
      /^\/skins\/([a-z0-9]{10})\/delete$/,
      async ({ req, res, params: [id] }) => {
        if (!(await readJson(req, res))) return; // body unused, but a same-origin JSON POST is the CSRF guard
        if (!store.removeSkin(id)) {
          json(res, 404, { error: '없는 스킨입니다.' });
          return;
        }
        json(res, 200, { ok: true });
      },
    ],
    [
      'POST',
      '/launch',
      async ({ req, res }) => {
        const data = await readJson(req, res);
        if (data) await launch(res, data);
      },
    ],
  ];
}
