// Full agent reply in a large dialog, markdown rendered. Opened from the panel's last-reply card (panel.tsx).
// The full text is fetched on demand (/sessions/:id/reply) — SSE only carries the short preview.
import { type ComponentChildren, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReplyReply, SessionSnapshot } from '../shared/api.ts';
import { getReply } from './api.ts';
import { renderMarkdown } from './markdown.ts';
import { BigDialog } from './modal.tsx';
import { css } from './style.ts';
import { fmtTime } from './ui.ts';

css(/* css */ `
#reply .body { flex: 1; overflow: auto; padding: 18px 26px 28px; }

.md {
  font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; font-size: 14.5px; line-height: 1.7; color: var(--text); word-break: keep-all; overflow-wrap: anywhere;
  & > :first-child { margin-top: 0; }
  & p, & ul, & ol, & pre, & blockquote, & .table { margin: 0 0 12px; }
  & h1, & h2, & h3, & h4, & h5, & h6 { margin: 22px 0 10px; line-height: 1.35; color: #fff; }
  & h1 { font-size: 22px; }
  & h2 { font-size: 19px; padding-bottom: 6px; border-bottom: 1px solid #2f3352; }
  & h3 { font-size: 16.5px; }
  & h4, & h5, & h6 { font-size: 14.5px; color: var(--accent); }
  & strong { color: #fff; }
  & a { color: #7cc4ff; }
  & ul, & ol { padding-left: 1.6em; }
  & li { margin: 3px 0; }
  & li > ul, & li > ol { margin: 3px 0 0; }
  & li::marker { color: var(--dim); }
  & .task-item { list-style: none; margin-left: -1.3em; }
  & .task { color: var(--dim); }
  & .task.done { color: #4ade80; }
  & code { font-family: "Cascadia Code", Consolas, "D2Coding", ui-monospace, monospace; font-variant-ligatures: none; font-size: .88em; padding: .12em .4em; border-radius: 4px; background: #2f3352; color: #ffe3a3; }
  & pre { position: relative; padding: 12px 14px; border-radius: 8px; background: #11131f; border: 1px solid #2a2e4a; line-height: 1.5; }
  & pre code { padding: 0; background: none; color: #d6dcf0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
  & pre code[data-lang]::before { content: attr(data-lang); position: absolute; top: 4px; right: 8px; font-size: 10.5px; color: var(--dim); }
  & blockquote { padding: 2px 14px; border-left: 3px solid var(--accent); color: #c9cde0; background: rgba(255,209,102,0.05); border-radius: 0 6px 6px 0; }
  & blockquote > :last-child { margin-bottom: 0; }
  & hr { border: 0; border-top: 1px solid #2f3352; margin: 18px 0; }
  & .table { overflow-x: auto; }
  & table { border-collapse: collapse; font-size: 13.5px; }
  & th, & td { border: 1px solid #2f3352; padding: 6px 10px; vertical-align: top; }
  & th { background: var(--panel-2); text-align: left; }
  & tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  & .dim { color: var(--dim); }
  & .warn { padding: 8px 12px; border-radius: 6px; background: rgba(248,113,113,0.12); color: #fca5a5; font-size: 13px; }
}
`);

interface Loaded {
  id: string;
  at: number; // lastTextAt of the text shown
  text: string;
  partial: boolean; // the full text couldn't be fetched: the SSE preview stands in
}

/**
 * Session `s`'s last answer, while `open`; fetched again when it answers anew. `children`: the panel's composer, so
 * instructions can go out from here too.
 */
export function Reply({
  s,
  open,
  onClose,
  children,
}: {
  s: SessionSnapshot | null;
  open: boolean;
  onClose: () => void;
  children?: ComponentChildren;
}) {
  const id = open ? s?.id : undefined;
  const at = s?.lastTextAt;
  const session = useRef(s);
  session.current = s;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    getReply(id)
      .catch(() => null) // server unreachable: fall back to the preview below
      .then((d: ReplyReply | null) => {
        const s = session.current;
        if (!live || !s) return;
        const r = d ?? { text: s.lastText || '', at: s.lastTextAt };
        setLoaded({ id, at: r.at, text: r.text || '', partial: !d });
      });
    return () => {
      live = false;
    };
  }, [id, at]);
  const cur = loaded && loaded.id === id ? loaded : null; // until it loads, not an earlier session's
  const meta = cur
    ? [s?.title, cur.at ? `${fmtTime(cur.at)} 답변` : '']
        .filter(Boolean)
        .join(' · ')
    : '';
  // The SSE preview is cut at 280 chars; say so rather than pass it off as the whole answer.
  const html = !cur
    ? ''
    : (cur.partial && cur.text
        ? '<p class="warn">전체 답변을 불러오지 못해 앞부분 미리보기만 보여줍니다. 서버가 이 기능 이전 버전이면 재시작해 주세요.</p>'
        : '') +
      (cur.text
        ? renderMarkdown(cur.text)
        : '<p class="dim">아직 답변이 없습니다.</p>');
  return (
    <BigDialog
      id="reply"
      open={!!id}
      onClose={onClose}
      title={s?.name ?? ''}
      meta={meta}
      copyTitle="마크다운 원문 복사"
      copy={() => cur?.text}
    >
      <Body html={html} at={cur?.at ?? -1} />
      {id && children}
    </BigDialog>
  );
}

/** The rendered answer; scrolled back to the top when a new one comes in. */
function Body({ html, at }: { html: string; at: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [at]);
  // renderMarkdown escapes everything it is given, so its HTML is safe to set
  return (
    <article
      class="body md"
      ref={ref}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
