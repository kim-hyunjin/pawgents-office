// Hiring from the launcher: POST /launch's body checked, then claude started through the chosen backend, in the
// selected worktree or in fresh ones branched off it (newWorktree: name / name-1, name-2, … per hire).
import path from 'node:path';
import type { LaunchReply } from '../../shared/api.ts';
import { codedError, errMessage } from '../../shared/errors.ts';
import { MAX_HIRES, WORKTREE_NAME_RE } from '../../shared/limits.ts';
import { MODEL_RE, PERMISSION_MODES } from '../../shared/permission.ts';
import { addWorktree, samePath, worktreesAt } from '../backends/git.ts';
import type { HeadlessBackend } from '../backends/headless.ts';
import type { OrcaBackend } from '../backends/orca.ts';
import { MAX_PROMPT_CHARS } from '../config.ts';
import { isDir } from '../infra/fs.ts';
import { BAD_REQUEST, failed, invalid, UNKNOWN_MODE } from './errors.ts';
import { preview } from './log.ts';
import type { BackendId, Logger } from './ports.ts';

const UNKNOWN_BRANCH = '기준 워크트리의 브랜치를 알 수 없습니다.';

interface Hire {
  prompt: string;
  model: string;
  count: number;
  /** New worktrees' name (one per hire), or null: work in the selected one. */
  name: string | null;
}
export interface OrcaHire extends Hire {
  backend: 'orca';
  worktreeId: string;
}
export interface HeadlessHire extends Hire {
  backend: 'headless';
  cwd: unknown;
  permissionMode: string;
}
export type LaunchRequest = OrcaHire | HeadlessHire;

/** What the launch flows need of the backends. */
export interface Launchers {
  orca: Pick<
    OrcaBackend,
    'listWorktrees' | 'launchClaude' | 'createWorktreeWithClaude'
  >;
  headless: Pick<HeadlessBackend, 'probe' | 'launch'>;
}

const BACKEND_IDS: BackendId[] = ['orca', 'headless'];

/** POST /launch's JSON as a request, or null when it is malformed (400 BAD_REQUEST). Per-backend checks come later. */
export function parseLaunchBody(
  data: Record<string, any>,
): LaunchRequest | null {
  const backend = String(data.backend || ''),
    prompt = String(data.prompt ?? '').trim(),
    model = String(data.model || '').trim();
  const count = Number(data.count ?? 1),
    name = data.newWorktree ? String(data.newWorktree.name || '').trim() : null;
  if (
    !BACKEND_IDS.includes(backend as BackendId) ||
    prompt.length > MAX_PROMPT_CHARS ||
    (model && !MODEL_RE.test(model)) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_HIRES ||
    (name !== null && !WORKTREE_NAME_RE.test(name))
  )
    return null;
  const hire = { prompt, model, count, name };
  if (backend === 'orca')
    return {
      backend,
      ...hire,
      worktreeId: String(data.worktreeId || ''),
    };
  return {
    backend: 'headless',
    ...hire,
    cwd: data.cwd,
    permissionMode:
      data.permissionMode == null || data.permissionMode === ''
        ? 'default'
        : String(data.permissionMode),
  };
}

/** The worktree a hire gets: `name` alone, or `name-1`, `name-2`, … when hiring several. */
const hireName = (name: string, count: number, i: number) =>
  count > 1 ? `${name}-${i}` : name;

/** Orca: one hire at a time (Orca creates checkouts / tabs sequentially anyway), a failure doesn't hide the rest. */
export async function launchOrca(
  orca: Launchers['orca'],
  logger: Logger,
  { worktreeId, prompt, model, count, name }: OrcaHire,
): Promise<LaunchReply> {
  if (!worktreeId) throw invalid(BAD_REQUEST);
  const base = (await orca.listWorktrees()).find((w) => w.id === worktreeId);
  if (!base) throw invalid('알 수 없는 워크트리입니다.');
  if (name !== null && !base.branch && !base.head)
    throw invalid(UNKNOWN_BRANCH);
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
      logger.info(
        `[web] launch claude in ${wtName ? `new worktree ${wtName} (from ${base.branch || base.head})` : base.path}${prompt ? ': ' + preview(prompt) : ''}`,
      );
    } catch (e) {
      errors.push(`${wtName || `#${i}`}: ${errMessage(e)}`);
    }
  }
  if (!started.length) throw failed(errors.join('\n'));
  return { ok: true, started: started.length, errors, sessions: [] };
}

/** Headless: worktrees (if any) are made one by one (git locks the repo), then every claude starts in parallel. */
export async function launchHeadless(
  headless: Launchers['headless'],
  logger: Logger,
  { cwd, prompt, model, count, name, permissionMode }: HeadlessHire,
): Promise<LaunchReply> {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !isDir(cwd))
    throw invalid('작업 폴더가 없습니다.');
  if (!PERMISSION_MODES.includes(permissionMode)) throw invalid(UNKNOWN_MODE);
  const p = await headless.probe();
  if (!p.available) throw codedError(p.reason, 'headless_unavailable');
  const dirs: string[] = [],
    errors: string[] = [];
  if (name === null) for (let i = 0; i < count; i++) dirs.push(cwd);
  else {
    // git's own list gives the main worktree's real-case path (repo keys are lowercased on Windows)
    const ws = await worktreesAt(cwd),
      sel = ws.find((w) => samePath(w.path, cwd));
    if (!sel) throw invalid('선택한 폴더가 git 워크트리가 아닙니다.');
    if (!sel.branch && !sel.head) throw invalid(UNKNOWN_BRANCH);
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
      logger.info(
        `[web] launch claude (headless) in ${dirs[i]}${prompt ? ': ' + preview(prompt) : ''}`,
      );
    } else
      errors.push(
        `${path.basename(dirs[i])}: ${r.reason?.message || r.reason}`,
      );
  });
  if (!sessions.length)
    throw failed(errors.join('\n') || '시작하지 못했습니다.');
  return { ok: true, started: sessions.length, errors, sessions };
}

/** One launch, by the backend the request names. Refusals are AppErrors; backend failures pass through. */
export function createLaunch({
  launchers,
  logger,
}: {
  launchers: Launchers;
  logger: Logger;
}) {
  return (req: LaunchRequest): Promise<LaunchReply> =>
    req.backend === 'orca'
      ? launchOrca(launchers.orca, logger, req)
      : launchHeadless(launchers.headless, logger, req);
}
