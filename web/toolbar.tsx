// The tool buttons above the office: 새 직원, 배치 편집, zoom (− / scale / +) and 모델 안내.
import { Fragment, h } from 'preact';
import { Pic } from './pic.tsx';
import { paletteFor, sprite } from './sprites.ts';
import { css } from './style.ts';

css(/* css */ `
#tools {
  display: flex; gap: 6px; margin-left: auto; padding-bottom: 4px;
  &.off { visibility: hidden; }
  & button {
    display: flex; align-items: center; gap: 6px; padding: 4px 10px; font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer;
    color: var(--text); background: var(--panel); border: 1px solid #2f3352; border-radius: 6px;
  }
  & button:hover { background: var(--panel-2); }
  & button.primary { color: #1f2233; background: #ffd166; border-color: #ffd166; font-weight: 700; }
  & button.primary:hover { background: #ffe08a; }
  & canvas { image-rendering: pixelated; }
  & .zoom { display: flex; }
  & .zoom button { border-radius: 0; padding: 4px 8px; min-width: 28px; justify-content: center; }
  & .zoom button:first-child { border-radius: 6px 0 0 6px; }
  & .zoom button:last-child { border-radius: 0 6px 6px 0; }
  & .zoom button + button { border-left: 0; }
  & .zoom .scale { color: var(--dim); font-variant-numeric: tabular-nums; }
  & .zoom .scale.pinned { color: var(--accent); }
  & .zoom button:disabled { opacity: .4; cursor: default; }
}
`);

// the legend button wears a cat, like the legend itself
const LEGEND_CAT = sprite(
  paletteFor('legend', 'employee', 'claude-fable'),
  'idle',
  0,
);

export function Toolbar({
  zoom,
  onNew,
  onEdit,
  onLegend,
  onZoom,
}: {
  /** The scale drawn at, whether it is pinned (else it fits the window), and the largest there is. */
  zoom: { scale: number; pinned: boolean; max: number };
  onNew: () => void;
  onEdit: () => void;
  onLegend: () => void;
  /** A scale to pin, or null: fit the window again. */
  onZoom: (scale: number | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        class="primary"
        title="새 Claude 세션을 띄웁니다"
        onClick={onNew}
      >
        + 새 직원
      </button>
      <button
        type="button"
        title="이 사무실의 방·가구·정문 배치를 바꿉니다"
        onClick={onEdit}
      >
        배치 편집
      </button>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a box of its own; the span keeps the three buttons joined */}
      <span class="zoom" role="group" aria-label="확대·축소">
        <button
          type="button"
          title="축소"
          disabled={zoom.scale <= 1}
          onClick={() => onZoom(zoom.scale - 1)}
        >
          −
        </button>
        <button
          type="button"
          class={zoom.pinned ? 'scale pinned' : 'scale'}
          title={
            zoom.pinned ? '눌러서 창 크기에 맞추기' : '창 크기에 맞춘 배율'
          }
          onClick={() => onZoom(null)}
        >
          {zoom.scale}×
        </button>
        <button
          type="button"
          title="확대"
          disabled={zoom.scale >= zoom.max}
          onClick={() => onZoom(zoom.scale + 1)}
        >
          +
        </button>
      </span>
      <button
        type="button"
        title="모델별 품종·직급·모니터와 현재 인원"
        onClick={onLegend}
      >
        <Pic img={LEGEND_CAT} />
        모델 안내
      </button>
    </>
  );
}
