// One file's git diff in a large dialog, colored by line. Opened from the panel's worked-file chips;
// the patch comes from /sessions/:id/diff (working tree vs HEAD, or the session's last commit of it).

import type { DiffReply, SessionSnapshot } from '../shared/api.ts';
import { getDiff } from './api.ts';
import { $, bindCopy, bindDialogClose, esc } from './ui.ts';

let dlg: HTMLDialogElement,
  nameEl: HTMLElement,
  metaEl: HTMLElement,
  warnEl: HTMLElement,
  body: HTMLElement;

let cur: { id: string; file: string; t: number; patch: string } | null = null;

/** Find the dialog's elements and wire them up; once, before openDiff(). */
export function initDiff() {
  dlg = $<HTMLDialogElement>('diff');
  nameEl = $('d-name');
  metaEl = $('d-meta');
  warnEl = $('d-warn');
  body = $('d-body');
  bindDialogClose(dlg, $('d-close'));
  dlg.addEventListener('close', () => {
    cur = null;
  });
  bindCopy($('d-copy'), () => cur?.patch);
}

const STATUS: Record<string, string> = {
  changed: 'HEAD 기준 작업 트리 변경',
  untracked: '새 파일 (아직 git에 추가되지 않음)',
  clean: 'HEAD와 차이 없음',
  missing: '파일이 없습니다',
};
const touchedAt = (s: SessionSnapshot, file: string) =>
  (s.files || []).find((f) => f.path === file)?.t ?? 0;

export function openDiff(s: SessionSnapshot, file: string) {
  cur = { id: s.id, file, t: touchedAt(s, file), patch: '' };
  nameEl.textContent = file.split(/[\\/]/).pop() ?? null;
  metaEl.textContent = file;
  warnEl.hidden = true;
  body.innerHTML = '';
  if (!dlg.open) dlg.showModal();
  load(s);
}

/** The session touched the open file again (a tool finished on it): fetch the diff anew. */
export function refreshDiff(s: SessionSnapshot) {
  if (!dlg.open || cur?.id !== s.id) return;
  const t = touchedAt(s, cur.file);
  if (t > cur.t) {
    cur.t = t;
    load(s);
  }
}

async function load(s: SessionSnapshot) {
  if (!cur) return;
  const { id, file } = cur;
  let d: DiffReply;
  try {
    d = await getDiff(id, file);
  } catch (e) {
    if (cur?.id !== id || cur.file !== file) return;
    warnEl.textContent = (e as Error).message;
    warnEl.hidden = false;
    body.innerHTML = '';
    return;
  }
  if (cur?.id !== id || cur.file !== file) return;
  cur.patch = d.patch || '';
  const { html, add, del } = render(cur.patch);
  const status =
    d.status === 'committed'
      ? `작업 트리에 변경 없음 · 세션 중 마지막 커밋 "${d.commit?.subject || d.commit?.hash?.slice(0, 7) || ''}" 기준`
      : STATUS[d.status] || d.status;
  metaEl.textContent = [
    d.rel || file,
    status,
    cur.patch ? `+${add} −${del}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  warnEl.textContent = d.truncated
    ? `diff가 너무 커서 앞부분 ${cur.patch.length.toLocaleString()}자만 보여줍니다.`
    : '';
  warnEl.hidden = !d.truncated;
  body.innerHTML =
    html || '<span class="l meta">(보여줄 diff가 없습니다)</span>';
  body.scrollTop = 0;
}

/** Unified diff → one block per line. Header lines (`---`/`+++`) count only before the first hunk. */
function render(patch: string) {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let add = 0,
    del = 0,
    header = true;
  const html = lines
    .map((line: string) => {
      let cls = 'ctx';
      if (line.startsWith('diff --git')) {
        header = true;
        cls = 'meta';
      } else if (line.startsWith('@@')) {
        header = false;
        cls = 'hunk';
      } else if (header || line.startsWith('\\ No newline')) cls = 'meta';
      else if (line.startsWith('+')) {
        cls = 'add';
        add++;
      } else if (line.startsWith('-')) {
        cls = 'del';
        del++;
      }
      return `<span class="l ${cls}">${esc(line)}</span>`;
    })
    .join('');
  return { html, add, del };
}
