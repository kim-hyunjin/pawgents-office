// One file's git diff in a large dialog, colored by line. Opened from the panel's worked-file chips;
// the patch comes from /sessions/:id/diff (working tree vs HEAD, or the session's last commit of it).

import { h, render as mount } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { SessionSnapshot } from '../shared/api.ts';
import { getDiff } from './api.ts';
import { BigDialog } from './modal.tsx';
import { css } from './style.ts';
import { $ } from './ui.ts';

css(/* css */ `
#diff {
  width: min(1100px, calc(100vw - 32px));
  & .warn { margin: 10px 18px 0; padding: 8px 12px; border-radius: 6px; background: rgba(248,113,113,0.12); color: #fca5a5; font-size: 13px; }
}
.diff {
  flex: 1; overflow: auto; margin: 0; padding: 14px 18px 24px; font: 12.5px/1.5 "Cascadia Code", Consolas, "D2Coding", ui-monospace, monospace;
  font-variant-ligatures: none; white-space: pre; tab-size: 4; color: #d6dcf0;
  & .l { display: block; padding: 0 8px; min-height: 1.5em; }
  & .add { color: #4ade80; background: rgba(74,222,128,0.08); }
  & .del { color: #f87171; background: rgba(248,113,113,0.08); }
  & .hunk { color: #7cc4ff; margin-top: 6px; }
  & .meta { color: var(--dim); }
}
`);

interface Line {
  cls: 'ctx' | 'meta' | 'hunk' | 'add' | 'del';
  text: string;
}
interface Shown {
  id: string;
  file: string;
  t: number; // when the session last touched the file, as of this load
  patch: string;
  meta: string;
  warn: string;
  lines: Line[] | null; // null: not loaded yet
}
let cur: Shown | null = null;
let root: HTMLElement;

/** Mount the dialog; once, before openDiff(). */
export function initDiff() {
  root = $('diff-root');
  draw();
}

function draw() {
  mount(
    <BigDialog
      id="diff"
      open={!!cur}
      onClose={() => {
        cur = null;
        draw();
      }}
      title={cur?.file.split(/[\\/]/).pop() ?? ''}
      meta={cur?.meta ?? ''}
      copyTitle="패치 복사"
      copy={() => cur?.patch}
    >
      {cur?.warn && <p class="warn">{cur.warn}</p>}
      <Patch lines={cur?.lines ?? null} />
    </BigDialog>,
    root,
  );
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
  cur = {
    id: s.id,
    file,
    t: touchedAt(s, file),
    patch: '',
    meta: file,
    warn: '',
    lines: null,
  };
  draw();
  load();
}

/** The session touched the open file again (a tool finished on it): fetch the diff anew. */
export function refreshDiff(s: SessionSnapshot) {
  if (cur?.id !== s.id) return;
  const t = touchedAt(s, cur.file);
  if (t > cur.t) {
    cur.t = t;
    load();
  }
}

async function load() {
  if (!cur) return;
  const shown = cur;
  try {
    const d = await getDiff(shown.id, shown.file);
    if (cur !== shown) return;
    shown.patch = d.patch || '';
    const { lines, add, del } = parse(shown.patch);
    const status =
      d.status === 'committed'
        ? `작업 트리에 변경 없음 · 세션 중 마지막 커밋 "${d.commit?.subject || d.commit?.hash?.slice(0, 7) || ''}" 기준`
        : STATUS[d.status] || d.status;
    shown.meta = [
      d.rel || shown.file,
      status,
      shown.patch ? `+${add} −${del}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    shown.warn = d.truncated
      ? `diff가 너무 커서 앞부분 ${shown.patch.length.toLocaleString()}자만 보여줍니다.`
      : '';
    shown.lines = lines;
  } catch (e) {
    if (cur !== shown) return;
    shown.warn = (e as Error).message;
    shown.lines = null;
  }
  draw();
}

function Patch({ lines }: { lines: Line[] | null }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [lines]);
  return (
    <pre class="diff" ref={ref}>
      {lines &&
        (lines.length ? (
          // lines never move, so their index is their key
          lines.map((l, i) => (
            <span key={i} class={`l ${l.cls}`}>
              {l.text}
            </span>
          ))
        ) : (
          <span class="l meta">(보여줄 diff가 없습니다)</span>
        ))}
    </pre>
  );
}

/** Unified diff → one line each. Header lines (`---`/`+++`) count only before the first hunk. */
function parse(patch: string) {
  const texts = patch.split('\n');
  if (texts.at(-1) === '') texts.pop();
  let add = 0,
    del = 0,
    header = true;
  const lines = texts.map((text): Line => {
    if (text.startsWith('diff --git')) {
      header = true;
      return { cls: 'meta', text };
    }
    if (text.startsWith('@@')) {
      header = false;
      return { cls: 'hunk', text };
    }
    if (header || text.startsWith('\\ No newline'))
      return { cls: 'meta', text };
    if (text.startsWith('+')) {
      add++;
      return { cls: 'add', text };
    }
    if (text.startsWith('-')) {
      del++;
      return { cls: 'del', text };
    }
    return { cls: 'ctx', text };
  });
  return { lines, add, del };
}
