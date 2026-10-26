// "모델 안내" dialog: which cat stands for which model, opened from the #t-legend toolbar button. Each model row has a
// breed picker; the choice is saved on the server and pushed to every open office (office.ts applies it). Also shows
// the kittens (subagents) and the receptionist, and manages uploaded skins: PNG sprite sheets that can stand in for a breed (format in sprites.ts SKIN_ROWS / README).

import type { SessionSnapshot } from '../shared/api.ts';
import {
  isCell,
  MAX_CELL,
  MAX_NAME_CHARS,
  MAX_SKIN_BYTES,
  MIN_CELL,
  skinGridError,
} from '../shared/limits.ts';
import { CAT_FAMILIES } from '../shared/model.ts';
import { deleteSkin, setCatChoice, uploadSkin } from './api.ts';
import {
  BREEDS,
  breedOf,
  breedPalette,
  choiceOf,
  FAMILIES,
  familyOf,
  type Palette,
  RECEPTIONIST_PAL,
  SKIN_ROW_LABEL,
  SKIN_ROWS,
  skinList,
  skinScale,
  skinTemplate,
  sliceSheet,
  sprite,
} from './sprites.ts';
import { armConfirm, bindDialogClose, downloadBlob, esc, pic } from './ui.ts';

let dlg: HTMLDialogElement, body: HTMLElement;
type Sessions = Map<string, SessionSnapshot>;
const MONITOR: Record<string, string> = {
  'wide-gold': '금색 와이드 모니터',
  silver: '실버 모니터',
  normal: '일반 모니터',
  laptop: '노트북',
};
const ZOOM = 2;

/** Find the dialog and wire its close button; once, before openLegend(). */
export function initLegend() {
  dlg = document.getElementById('legend') as HTMLDialogElement;
  body = document.getElementById('lg-body')!;
  bindDialogClose(dlg, document.getElementById('lg-close')!);
}

const cat = (pal: Palette, anim = 'idle') => pic(sprite(pal, anim, 0), ZOOM);

/** Pictures for a breed or skin: every coat of a breed, or a skin's seated and walking frames. */
function looks(breed: string, kind = 'employee') {
  if (BREEDS[breed])
    return BREEDS[breed].coats.map((_, i) => cat(breedPalette(breed, i, kind)));
  const pal = breedPalette(breed, 0, kind);
  return kind === 'assistant' ? [cat(pal)] : [cat(pal), cat(pal, 'walk')];
}

function row(cats: HTMLElement[], title: string, lines: string[]) {
  const li = document.createElement('li');
  const pics = document.createElement('div');
  pics.className = 'cats';
  pics.append(...cats);
  const text = document.createElement('div');
  text.innerHTML = `<b>${title}</b>${lines.map((l: string) => `<div class="dim">${l}</div>`).join('')}`;
  li.append(pics, text);
  return li;
}

/** Breed <select> for a model family (uploaded skins in their own group); picking one asks the server to save it. */
function breedPicker(fam: string) {
  const sel = document.createElement('select');
  sel.className = 'breed';
  const def = FAMILIES[fam].breed,
    cur = choiceOf(fam);
  const opt = (k: string, label: string, extra = '') =>
    `<option value="${esc(k)}"${k === cur ? ' selected' : ''}${extra}>${esc(label)}</option>`;
  const skins = skinList();
  sel.innerHTML =
    Object.entries(BREEDS)
      .map(([k, b]) => opt(k, b.name + (k === def ? ' (기본)' : '')))
      .join('') +
    (skins.length
      ? `<optgroup label="내 스킨">${skins.map((s) => opt(`skin:${s.id}`, s.name + (s.failed ? ' (불러오지 못함)' : ''), s.failed ? ' disabled' : '')).join('')}</optgroup>`
      : '');
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    try {
      await setCatChoice(fam, sel.value === def ? null : sel.value);
    } catch (e) {
      sel.value = choiceOf(fam);
      alertRow(sel, (e as Error).message);
    } finally {
      sel.disabled = false;
    }
  });
  return sel;
}
function alertRow(el: HTMLElement, text: string) {
  const parent = el.parentElement!;
  const msg =
    parent.querySelector('.err') ||
    Object.assign(document.createElement('div'), { className: 'err' });
  msg.textContent = `실패: ${text}`;
  parent.append(msg);
}

let lastSessions: Sessions | null = null;
/** Re-render while open (the server confirmed a breed or skin change, so coats and labels follow). */
export function refreshLegend() {
  if (dlg.open && lastSessions) render(lastSessions);
}

export function openLegend(sessions: Sessions) {
  render(sessions);
  dlg.showModal();
}

function render(sessions: Sessions) {
  lastSessions = sessions;
  const scroll = body.scrollTop;
  const count: Record<string, number> = {};
  for (const s of sessions.values())
    if (!s.ended) {
      const f = familyOf(s.model);
      count[f] = (count[f] || 0) + 1;
    }
  const list = document.createElement('ul');
  for (const [fam, f] of Object.entries(FAMILIES)) {
    const n = count[fam] || 0;
    const li = row(
      looks(breedOf(fam)),
      esc([f.label, f.title].filter(Boolean).join(' · ')),
      [
        esc(MONITOR[f.monitor] || f.monitor),
        n ? `지금 ${n}명 근무 중` : '지금 근무 중인 직원 없음',
      ],
    );
    li.querySelector('b')!.after(breedPicker(fam));
    list.append(li);
  }
  list.append(
    row(
      CAT_FAMILIES.filter((f) => f !== 'other').map(
        (fam) => looks(breedOf(fam), 'assistant')[0],
      ),
      '보조 직원 (서브에이전트)',
      ['부모 직원과 같은 품종의 새끼 고양이. 회의실이나 책상 옆에서 일해요.'],
    ),
    row([cat(RECEPTIONIST_PAL)], '안내원', [
      '로비 카운터에 상주하는 안내 로봇. 세션과는 무관해요.',
    ]),
  );
  body.replaceChildren(list, skinSection());
  body.scrollTop = scroll;
}

// ---- skins ---------------------------------------------------------------------------
interface Draft {
  dataUrl?: string;
  bmp?: ImageBitmap;
  name: string;
  cellW?: number;
  cellH?: number;
  error: string | null;
}
let draft: Draft | null = null; // sheet picked for upload
const delArm = armConfirm<string>(3000, () => refreshLegend()); // skin id whose 삭제 button waits for the confirming click

function skinSection() {
  const sec = document.createElement('section');
  sec.className = 'skins';
  sec.innerHTML = `<h3>스킨</h3>
    <div class="dim">직접 그린 PNG 스프라이트 시트를 올리면 위 목록에서 품종 대신 고를 수 있어요.
      같은 크기 칸으로 나눈 격자에 한 줄에 동작 하나, 칸마다 프레임 하나를 그립니다(앉아 있기·걷기 두 줄은 꼭 필요).
      템플릿에 지금 고양이가 줄 순서대로 그려져 있으니 그 위에 덧그리면 됩니다.</div>
    <div class="acts"><button type="button" data-act="template">템플릿 내려받기</button>
      <label class="file">PNG 올리기<input type="file" accept="image/png" hidden></label></div>`;
  sec
    .querySelector('[data-act=template]')!
    .addEventListener('click', downloadTemplate);
  sec.querySelector('input[type=file]')!.addEventListener('change', (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) pickFile(f);
  });
  if (draft) sec.append(draftForm());
  const skins = skinList();
  if (skins.length) {
    const ul = document.createElement('ul');
    for (const s of skins) ul.append(skinRow(s));
    sec.append(ul);
  }
  return sec;
}

function skinRow(s: ReturnType<typeof skinList>[number]) {
  const key = `skin:${s.id}`;
  const users = Object.keys(FAMILIES)
    .filter((fam) => choiceOf(fam) === key)
    .map((fam) => FAMILIES[fam].label);
  const pics = s.rows ? looks(key) : [];
  const li = row(pics, esc(s.name), [
    s.failed
      ? '이미지를 불러오지 못했어요.'
      : !s.rows
        ? '불러오는 중…'
        : `${Object.keys(s.rows).length}가지 동작 · 칸 ${s.cellW}×${s.cellH}`,
    users.length ? `${esc(users.join('·'))}에서 사용 중` : '사용하는 모델 없음',
  ]);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = delArm.is(s.id) ? '정말 삭제' : '삭제';
  del.classList.toggle('armed', delArm.is(s.id));
  del.title = users.length
    ? '삭제하면 이 스킨을 쓰던 모델은 기본 품종으로 돌아가요.'
    : '';
  del.addEventListener('click', async () => {
    if (!delArm.click(s.id)) return; // first click arms, second confirms
    delArm.disarm();
    del.disabled = true;
    try {
      await deleteSkin(s.id);
    } catch (e) {
      del.disabled = false;
      alertRow(del, (e as Error).message);
    }
  });
  li.append(del);
  return li;
}

async function downloadTemplate() {
  downloadBlob(await skinTemplate(), 'pawgents-skin-template.png');
}

/** A cell size the sheet divides into evenly, with a sensible row count; 16 if nothing fits. */
function guessCell(w: number, h: number) {
  return (
    [16, 32, 24, 48, 64, 12, 8].find((c) => !skinGridError(w, h, c, c)) || 16
  );
}

async function pickFile(file: File) {
  const name =
    file.name.replace(/\.png$/i, '').slice(0, MAX_NAME_CHARS) || '스킨';
  try {
    if (file.size > MAX_SKIN_BYTES)
      throw new Error(`파일이 너무 큽니다(최대 ${MAX_SKIN_BYTES / 1024}KB).`);
    const bmp = await createImageBitmap(file);
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const c = guessCell(bmp.width, bmp.height);
    draft = { name, dataUrl, bmp, cellW: c, cellH: c, error: null };
  } catch (e) {
    draft = {
      name,
      error: (e as Error).message || 'PNG 이미지를 읽지 못했습니다.',
    };
  }
  refreshLegend();
}

function draftForm() {
  const d = draft as Draft & { bmp: ImageBitmap; cellW: number; cellH: number };
  const box = document.createElement('div');
  box.className = 'draft';
  if (!d.bmp) {
    box.innerHTML = `<div class="err">${esc(d.error)}</div><div class="acts"><button type="button" data-act="cancel">닫기</button></div>`;
    box.querySelector('[data-act=cancel]')!.addEventListener('click', () => {
      draft = null;
      refreshLegend();
    });
    return box;
  }
  box.innerHTML = `<div class="fields">
      <label>이름 <input name="name" maxlength="${MAX_NAME_CHARS}" value="${esc(d.name)}"></label>
      <label>칸 <input name="cellW" type="number" min="${MIN_CELL}" max="${MAX_CELL}" value="${d.cellW}"> × <input name="cellH" type="number" min="${MIN_CELL}" max="${MAX_CELL}" value="${d.cellH}"> px</label>
      <span class="dim">${d.bmp.width}×${d.bmp.height}</span>
    </div>
    <ol class="frames"></ol>
    <div class="err"></div>
    <div class="acts"><button type="button" class="primary" data-act="upload">올리기</button><button type="button" data-act="cancel">취소</button></div>`;
  const [nameIn, wIn, hIn] = ['name', 'cellW', 'cellH'].map(
    (n) => box.querySelector<HTMLInputElement>(`input[name=${n}]`)!,
  );
  const errEl = box.querySelector('.err')!,
    frames = box.querySelector('.frames')!;
  const up = box.querySelector<HTMLButtonElement>('[data-act=upload]')!;
  // preview: each row's frames as the office will cut them, or what's missing
  const preview = () => {
    d.name = nameIn.value;
    d.cellW = Number(wIn.value) || 0;
    d.cellH = Number(hIn.value) || 0;
    // same grid checks as the server, so most mistakes show before uploading
    let err =
      isCell(d.cellW) && isCell(d.cellH)
        ? skinGridError(d.bmp.width, d.bmp.height, d.cellW, d.cellH)
        : `칸 크기는 ${MIN_CELL}–${MAX_CELL}px이어야 해요.`;
    const rows = err ? {} : sliceSheet(d.bmp, d.cellW, d.cellH);
    if (!err && (!rows.idle || !rows.walk))
      err = '첫 줄(앉아 있기)과 둘째 줄(걷기)에 그림이 있어야 해요.';
    frames.replaceChildren(
      ...(err
        ? []
        : SKIN_ROWS.map((anim) => {
            const li = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = SKIN_ROW_LABEL[anim];
            li.append(label);
            if (rows[anim])
              li.append(
                ...rows[anim].map((f) =>
                  pic(Object.assign(f, { scale: skinScale(f.height) }), 2),
                ),
              );
            else
              li.append(
                Object.assign(document.createElement('span'), {
                  className: 'dim',
                  textContent: '없음 — 비슷한 동작으로 대신해요',
                }),
              );
            return li;
          })),
    );
    errEl.textContent = err || '';
    up.disabled = !!err || !d.name.trim();
  };
  for (const el of [nameIn, wIn, hIn]) el.addEventListener('input', preview);
  preview();
  box.querySelector('[data-act=cancel]')!.addEventListener('click', () => {
    draft = null;
    refreshLegend();
  });
  up.addEventListener('click', async () => {
    up.disabled = true;
    try {
      await uploadSkin({
        name: d.name.trim(),
        cellW: d.cellW,
        cellH: d.cellH,
        png: d.dataUrl,
      });
      draft = null;
      refreshLegend(); // the new skin arrives with the server's 'settings' push
    } catch (e) {
      errEl.textContent = `올리기 실패: ${(e as Error).message}`;
      up.disabled = false;
    }
  });
  return box;
}
