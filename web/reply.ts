// Full agent reply in a large dialog, markdown rendered. Opened from the panel's last-reply card.
// The full text is fetched on demand (/sessions/:id/reply) — SSE only carries the short preview.
import type { SessionSnapshot } from '../server/types.ts';
import { api } from './api.ts';
import { renderMarkdown } from './markdown.ts';
import { $, bindDialogClose, fmtTime } from './ui.ts';

const dlg = $<HTMLDialogElement>('reply');
const nameEl = $('r-name');
const metaEl = $('r-meta');
const body = $('r-body');
const copyBtn = $('r-copy');

const compose = $('p-compose');
const composeHome = compose.parentNode!,
  composeNext = compose.nextSibling;

let cur: { id: string; at: number; text: string } | null = null;

bindDialogClose(dlg, $('r-close'));
dlg.addEventListener('close', () => {
  cur = null;
  composeHome.insertBefore(compose, composeNext); // hand the composer back to the panel
});
copyBtn.addEventListener('click', async () => {
  if (!cur) return;
  try {
    await navigator.clipboard.writeText(cur.text);
    copyBtn.textContent = '복사됨 ✓';
  } catch {
    copyBtn.textContent = '복사 실패';
  }
  setTimeout(() => {
    copyBtn.textContent = '복사';
  }, 1500);
});

export function openReply(s: SessionSnapshot) {
  cur = { id: s.id, at: -1, text: '' };
  nameEl.textContent = s.name;
  metaEl.textContent = '';
  body.innerHTML = '';
  // Borrow the panel's composer (same input, draft and send state) so instructions can go out from here.
  dlg.append(compose);
  if (!dlg.open) dlg.showModal();
  load(s);
}

/** Keep an open dialog in sync when the same session answers again. */
export function refreshReply(s: SessionSnapshot) {
  if (dlg.open && cur?.id === s.id && s.lastTextAt !== cur.at) load(s);
}

async function load(s: SessionSnapshot) {
  const id = s.id;
  let d: { text?: string; at: number } | null = null;
  try {
    d = await api(`/sessions/${encodeURIComponent(id)}/reply`);
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
