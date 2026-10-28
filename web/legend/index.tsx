// "모델 안내" dialog: which cat stands for which model, opened from the toolbar's 모델 안내 button (app.tsx). Each model row has a
// breed picker; the choice is saved on the server and pushed to every open office (office.ts applies it). Also shows
// the kittens (subagents) and the receptionist, and manages uploaded skins (skins.tsx).

import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { CAT_FAMILIES } from '../../shared/model.ts';
import { setCatChoice } from '../api.ts';
import { CloseButton } from '../bits.tsx';
import { useArm, useKeyMap, useKeySet } from '../hooks.ts';
import { Modal } from '../modal.tsx';
import {
  BREEDS,
  breedOf,
  choiceOf,
  FAMILIES,
  familyOf,
  RECEPTIONIST_PAL,
  skinList,
} from '../sprites.ts';
import { css } from '../style.ts';
import { type Ctx, cat, looks, Row, type Sessions } from './row.tsx';
import { Skins } from './skins.tsx';

css(/* css */ `
#legend {
  width: min(560px, calc(100vw - 32px)); max-height: 86vh; padding: 0; border: 1px solid #3b3f5c; border-radius: 10px;
  background: var(--panel); color: var(--text); box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  &[open] { display: flex; flex-direction: column; }
  &::backdrop { background: rgba(8,9,20,0.6); }
  & header { display: flex; align-items: center; padding: 12px 16px 10px 20px; border-bottom: 1px solid #2f3352; }
  & h2 { flex: 1; margin: 0; font-size: 16px; }
  & .close { font: inherit; font-size: 18px; padding: 0 10px; line-height: 28px; border-radius: 6px; border: 0; cursor: pointer; background: var(--panel-2); color: var(--text); }
}
#legend .body {
  overflow: auto; padding: 6px 20px 16px;
  & ul { list-style: none; margin: 0; padding: 0; }
  & li { display: flex; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px solid #2a2e4a; font-size: 13px; }
  & li:last-child { border-bottom: 0; }
  & .cats { flex: none; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px; width: 200px; padding: 6px 8px; border-radius: 6px; background: #cdb089; }
  & .cats canvas { image-rendering: pixelated; }
  & .dim { color: var(--dim); font-size: 12px; margin-top: 3px; }
  & .breed { margin-left: 8px; font: inherit; font-size: 12px; padding: 2px 4px; border-radius: 5px; border: 1px solid #3b3f5c; background: var(--panel-2); color: var(--text); }
  & .err { color: #f87171; font-size: 12px; margin-top: 3px; }
}
`);

const MONITOR: Record<string, string> = {
  'wide-gold': '금색 와이드 모니터',
  silver: '실버 모니터',
  normal: '일반 모니터',
  laptop: '노트북',
};

/** `looks`: goes up when the server confirms a breed or skin change (state.ts), so coats and labels follow. */
export function Legend({
  open,
  onClose,
  sessions,
  looks,
}: {
  open: boolean;
  onClose: () => void;
  sessions: Sessions;
  looks: number;
}) {
  const picking = useKeyMap<string, string>();
  const busy = useKeySet<string>();
  const errs = useKeyMap<string, string>();
  const delArm = useArm<string>(3000);
  // a new `looks` is the server confirming the picks: show what it has
  useEffect(() => picking.clear(), [looks]);
  useEffect(() => {
    if (open) errs.clear();
  }, [open]);
  const ctx: Ctx = {
    sessions,
    picking,
    busy,
    errs,
    delArm,
    async run(key, req, undo) {
      busy.add(key);
      errs.delete(key);
      try {
        await req();
      } catch (err) {
        undo?.();
        errs.set(key, (err as Error).message);
      } finally {
        busy.delete(key);
      }
    },
  };
  return (
    <Modal id="legend" open={open} onClose={onClose}>
      <header>
        <h2>모델 안내</h2>
        <CloseButton onClick={onClose} />
      </header>
      {open && <Body ctx={ctx} />}
    </Modal>
  );
}

function Body({ ctx }: { ctx: Ctx }) {
  const count: Record<string, number> = {};
  for (const s of ctx.sessions.values())
    if (!s.ended) {
      const f = familyOf(s.model);
      count[f] = (count[f] || 0) + 1;
    }
  return (
    <div class="body">
      <ul>
        {Object.entries(FAMILIES).map(([fam, f]) => {
          const n = count[fam] || 0;
          return (
            <Row
              key={fam}
              cats={looks(breedOf(fam))}
              title={[f.label, f.title].filter(Boolean).join(' · ')}
              extra={<BreedPicker fam={fam} ctx={ctx} />}
              lines={[
                MONITOR[f.monitor] || f.monitor,
                n ? `지금 ${n}명 근무 중` : '지금 근무 중인 직원 없음',
              ]}
              err={ctx.errs.get(`fam:${fam}`)}
            />
          );
        })}
        <Row
          cats={CAT_FAMILIES.filter((f) => f !== 'other').flatMap((fam) =>
            looks(breedOf(fam), 'assistant').slice(0, 1),
          )}
          title="보조 직원 (서브에이전트)"
          lines={[
            '부모 직원과 같은 품종의 새끼 고양이. 회의실이나 책상 옆에서 일해요.',
          ]}
        />
        <Row
          cats={[cat(RECEPTIONIST_PAL)]}
          title="안내원"
          lines={['로비 카운터에 상주하는 안내 로봇. 세션과는 무관해요.']}
        />
      </ul>
      <Skins ctx={ctx} />
    </div>
  );
}

/** Breed <select> for a model family (uploaded skins in their own group); picking one asks the server to save it. */
function BreedPicker({ fam, ctx }: { fam: string; ctx: Ctx }) {
  const def = (FAMILIES[fam] ?? FAMILIES.other).breed;
  const key = `fam:${fam}`;
  const skins = skinList();
  return (
    <select
      class="breed"
      value={ctx.picking.get(fam) ?? choiceOf(fam)}
      disabled={ctx.busy.has(key)}
      onChange={(e) => {
        const v = e.currentTarget.value;
        ctx.picking.set(fam, v);
        ctx.run(
          key,
          () => setCatChoice(fam, v === def ? null : v),
          () => ctx.picking.delete(fam), // back to what the server has
        );
      }}
    >
      {Object.entries(BREEDS).map(([k, b]) => (
        <option key={k} value={k}>
          {b.name + (k === def ? ' (기본)' : '')}
        </option>
      ))}
      {skins.length > 0 && (
        <optgroup label="내 스킨">
          {skins.map((s) => (
            <option key={s.id} value={`skin:${s.id}`} disabled={s.failed}>
              {s.name + (s.failed ? ' (불러오지 못함)' : '')}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
