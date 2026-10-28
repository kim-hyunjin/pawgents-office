// The 모델 안내 dialog's skins: uploaded PNG sprite sheets that can stand in for a breed (format in sprites.ts
// SKIN_ROWS / README) — the template, picking and previewing a sheet before upload, and deleting one.

import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  isCell,
  MAX_CELL,
  MAX_NAME_CHARS,
  MAX_SKIN_BYTES,
  MIN_CELL,
  skinGridError,
} from '../../../shared/limits.ts';
import { Pic } from '../../common/pic.tsx';
import { css } from '../../common/style.ts';
import { downloadBlob } from '../../common/ui.ts';
import { deleteSkin, uploadSkin } from '../../data/api.ts';
import {
  choiceOf,
  FAMILIES,
  SKIN_ROW_LABEL,
  SKIN_ROWS,
  skinList,
  skinScale,
  skinTemplate,
  sliceSheet,
} from '../../scene/sprites.ts';
import { type Ctx, looks, Row } from './row.tsx';

css(/* css */ `
#legend .body {
  & .skins {
    margin-top: 8px; padding-top: 12px; border-top: 1px solid #2f3352; font-size: 13px;
    & h3 { margin: 0 0 4px; font-size: 14px; }
    & .acts { display: flex; gap: 8px; margin: 10px 0 4px; }
    & button, & .file {
      font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #3b3f5c; cursor: pointer; background: var(--panel-2); color: var(--text);
    }
    & button.primary { background: var(--accent); border-color: var(--accent); color: #1f2233; font-weight: 700; }
    & li { gap: 12px; }
    & li > div:nth-child(2) { flex: 1; min-width: 0; }
    & .del { flex: none; }
    & .del:hover { background: #4a2e3a; }
    & .del.armed { background: #b4413c; border-color: #b4413c; color: #fff; }
  }
  & .draft {
    margin: 8px 0; padding: 10px 12px; border: 1px dashed #3b3f5c; border-radius: 8px;
    & .fields { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
    & input { font: inherit; font-size: 12px; padding: 2px 6px; border-radius: 5px; border: 1px solid #3b3f5c; background: var(--panel-2); color: var(--text); }
    & input[name=name] { width: 140px; }
    & input[type=number] { width: 52px; }
    & .frames { list-style: none; margin: 8px 0 0; padding: 0; }
    & .frames li { display: flex; align-items: flex-end; gap: 6px; padding: 3px 0; border: 0; font-size: 12px; }
    & .frames li > span:first-child { flex: none; width: 170px; color: var(--dim); }
    & .frames canvas { image-rendering: pixelated; background: #cdb089; border-radius: 3px; }
  }
}
`);

interface Draft {
  dataUrl?: string;
  bmp?: ImageBitmap;
  name: string;
  cellW: number;
  cellH: number;
  error: string | null; // the file couldn't be read
  uploadErr: string | null;
  uploading: boolean;
}
export function Skins({ ctx }: { ctx: Ctx }) {
  const skins = skinList();
  const [draft, setDraft] = useState<Draft | null>(null); // sheet picked for upload
  return (
    <section class="skins">
      <h3>스킨</h3>
      <div class="dim">
        직접 그린 PNG 스프라이트 시트를 올리면 위 목록에서 품종 대신 고를 수
        있어요. 같은 크기 칸으로 나눈 격자에 한 줄에 동작 하나, 칸마다 프레임
        하나를 그립니다(앉아 있기·걷기 두 줄은 꼭 필요). 템플릿에 지금 고양이가
        줄 순서대로 그려져 있으니 그 위에 덧그리면 됩니다.
      </div>
      <div class="acts">
        <button type="button" onClick={downloadTemplate}>
          템플릿 내려받기
        </button>
        <label class="file">
          PNG 올리기
          <input
            type="file"
            accept="image/png"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = ''; // the same file again is a new pick
              if (f) readSheet(f).then(setDraft);
            }}
          />
        </label>
      </div>
      {draft && <DraftForm d={draft} setDraft={setDraft} />}
      {skins.length > 0 && (
        <ul>
          {skins.map((s) => (
            <SkinRow key={s.id} s={s} ctx={ctx} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SkinRow({
  s,
  ctx,
}: {
  s: ReturnType<typeof skinList>[number];
  ctx: Ctx;
}) {
  const key = `skin:${s.id}`;
  const users = Object.keys(FAMILIES)
    .filter((fam) => choiceOf(fam) === key)
    .map((fam) => FAMILIES[fam]?.label);
  const armed = ctx.delArm.is(s.id);
  return (
    <Row
      cats={s.rows ? looks(key) : []}
      title={s.name}
      lines={[
        s.failed
          ? '이미지를 불러오지 못했어요.'
          : !s.rows
            ? '불러오는 중…'
            : `${Object.keys(s.rows).length}가지 동작 · 칸 ${s.cellW}×${s.cellH}`,
        users.length ? `${users.join('·')}에서 사용 중` : '사용하는 모델 없음',
      ]}
      err={ctx.errs.get(key)}
      tail={
        <button
          type="button"
          class={armed ? 'del armed' : 'del'}
          disabled={ctx.busy.has(key)}
          title={
            users.length
              ? '삭제하면 이 스킨을 쓰던 모델은 기본 품종으로 돌아가요.'
              : ''
          }
          onClick={() => {
            if (!ctx.delArm.click(s.id)) return; // first click arms, second confirms
            ctx.delArm.disarm();
            ctx.run(key, () => deleteSkin(s.id)); // the row goes with the server's 'settings' push
          }}
        >
          {armed ? '정말 삭제' : '삭제'}
        </button>
      }
    />
  );
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

/** A picked PNG as an upload draft (or the reason it can't be one). */
async function readSheet(file: File): Promise<Draft> {
  const name =
    file.name.replace(/\.png$/i, '').slice(0, MAX_NAME_CHARS) || '스킨';
  const empty = { uploadErr: null, uploading: false };
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
    return { name, dataUrl, bmp, cellW: c, cellH: c, error: null, ...empty };
  } catch (e) {
    return {
      name,
      cellW: 0,
      cellH: 0,
      error: (e as Error).message || 'PNG 이미지를 읽지 못했습니다.',
      ...empty,
    };
  }
}

function DraftForm({
  d,
  setDraft,
}: {
  d: Draft;
  setDraft: (d: Draft | null) => void;
}) {
  const close = () => setDraft(null);
  const bmp = d.bmp;
  // same grid checks as the server, so most mistakes show before uploading
  const gridErr = !bmp
    ? null
    : isCell(d.cellW) && isCell(d.cellH)
      ? skinGridError(bmp.width, bmp.height, d.cellW, d.cellH)
      : `칸 크기는 ${MIN_CELL}–${MAX_CELL}px이어야 해요.`;
  // cut the sheet again only when the grid changed, not on every keystroke in the name
  const rows = useMemo(
    () => (bmp && !gridErr ? sliceSheet(bmp, d.cellW, d.cellH) : {}),
    [bmp, d.cellW, d.cellH, gridErr],
  );
  if (!bmp)
    return (
      <div class="draft">
        <div class="err">{d.error}</div>
        <div class="acts">
          <button type="button" onClick={close}>
            닫기
          </button>
        </div>
      </div>
    );
  let err = gridErr;
  if (!err && (!rows.idle || !rows.walk))
    err = '첫 줄(앉아 있기)과 둘째 줄(걷기)에 그림이 있어야 해요.';
  const edit = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  async function upload() {
    edit({ uploading: true, uploadErr: null });
    try {
      await uploadSkin({
        name: d.name.trim(),
        cellW: d.cellW,
        cellH: d.cellH,
        png: d.dataUrl,
      });
      close(); // the new skin arrives with the server's 'settings' push
    } catch (e) {
      edit({
        uploading: false,
        uploadErr: `올리기 실패: ${(e as Error).message}`,
      });
    }
  }
  return (
    <div class="draft">
      <div class="fields">
        <label>
          이름{' '}
          <input
            name="name"
            maxLength={MAX_NAME_CHARS}
            value={d.name}
            onInput={(e) => edit({ name: e.currentTarget.value })}
          />
        </label>
        <label>
          칸{' '}
          <input
            name="cellW"
            type="number"
            min={MIN_CELL}
            max={MAX_CELL}
            value={d.cellW}
            onInput={(e) => edit({ cellW: Number(e.currentTarget.value) || 0 })}
          />{' '}
          ×{' '}
          <input
            name="cellH"
            type="number"
            min={MIN_CELL}
            max={MAX_CELL}
            value={d.cellH}
            onInput={(e) => edit({ cellH: Number(e.currentTarget.value) || 0 })}
          />{' '}
          px
        </label>
        <span class="dim">
          {bmp.width}×{bmp.height}
        </span>
      </div>
      {/* preview: each row's frames as the office will cut them, or what's missing */}
      <ol class="frames">
        {!err &&
          SKIN_ROWS.map((anim) => {
            const frames = rows[anim];
            return (
              <li key={anim}>
                <span>{SKIN_ROW_LABEL[anim] ?? anim}</span>
                {frames ? (
                  frames.map((f, i) => (
                    <Pic
                      // frames of one row are cut together
                      key={i}
                      img={Object.assign(f, { scale: skinScale(f.height) })}
                      zoom={2}
                    />
                  ))
                ) : (
                  <span class="dim">없음 — 비슷한 동작으로 대신해요</span>
                )}
              </li>
            );
          })}
      </ol>
      <div class="err">{d.uploadErr || err || ''}</div>
      <div class="acts">
        <button
          type="button"
          class="primary"
          disabled={!!err || !d.name.trim() || d.uploading}
          onClick={upload}
        >
          올리기
        </button>
        <button type="button" onClick={close}>
          취소
        </button>
      </div>
    </div>
  );
}
