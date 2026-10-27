// Full agent reply in a large dialog, markdown rendered. Opened from the panel's last-reply card.
// The full text is fetched on demand (/sessions/:id/reply) — SSE only carries the short preview.
import type { ReplyReply, SessionSnapshot } from '../shared/api.ts';
import { getReply } from './api.ts';
import { renderMarkdown } from './markdown.ts';
import { $, bindCopy, bindDialogClose, fmtTime } from './ui.ts';

let dlg: HTMLDialogElement,
  nameEl: HTMLElement,
  metaEl: HTMLElement,
  body: HTMLElement,
  composeSlot: HTMLElement;
let lendComposer: (host: HTMLElement | null) => void = () => {};

let cur: { id: string; at: number; text: string } | null = null;

/**
 * Find the dialog's elements and wire them up; once, before openReply(). `composer(host)` draws the panel's composer
 * in the dialog (host) while it is open and back in the panel (null) once it closes.
 */
export function initReply({
  composer,
}: {
  composer: (host: HTMLElement | null) => void;
}) {
  dlg = $<HTMLDialogElement>('reply');
  nameEl = $('r-name');
  metaEl = $('r-meta');
  body = $('r-body');
  composeSlot = $('r-compose');
  lendComposer = composer;
  bindDialogClose(dlg, $('r-close'));
  dlg.addEventListener('close', () => {
    cur = null;
    lendComposer(null); // hand the composer back to the panel
  });
  bindCopy($('r-copy'), () => cur?.text);
}

export function openReply(s: SessionSnapshot) {
  cur = { id: s.id, at: -1, text: '' };
  nameEl.textContent = s.name;
  metaEl.textContent = '';
  body.innerHTML = '';
  // Borrow the panel's composer (same draft and send state) so instructions can go out from here.
  lendComposer(composeSlot);
  if (!dlg.open) dlg.showModal();
  load(s);
}

/** Keep an open dialog in sync when the same session answers again. */
export function refreshReply(s: SessionSnapshot) {
  if (dlg.open && cur?.id === s.id && s.lastTextAt !== cur.at) load(s);
}

async function load(s: SessionSnapshot) {
  const id = s.id;
  let d: ReplyReply | null = null;
  try {
    d = await getReply(id);
  } catch {
    /* server unreachable — fall back to the preview below */
  }
  if (cur?.id !== id) return;
  // The SSE preview is cut at 280 chars; say so rather than pass it off as the whole answer.
  const partial = !d;
  const r = d ?? { text: s.lastText || '', at: s.lastTextAt };
  cur = { id, at: r.at, text: r.text || '' };
  metaEl.textContent = [s.title, r.at ? `${fmtTime(r.at)} 답변` : '']
    .filter(Boolean)
    .join(' · ');
  body.innerHTML =
    (partial && cur.text
      ? '<p class="warn">전체 답변을 불러오지 못해 앞부분 미리보기만 보여줍니다. 서버가 이 기능 이전 버전이면 재시작해 주세요.</p>'
      : '') +
    (cur.text
      ? renderMarkdown(cur.text)
      : '<p class="dim">아직 답변이 없습니다.</p>');
  body.scrollTop = 0;
}
