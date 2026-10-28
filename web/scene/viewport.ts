import type { Rect } from '../../shared/layout.ts';
import { WALL_RISE } from '../../shared/layout.ts';
import { clamp } from '../../shared/math.ts';
import { $, storage } from '../common/ui.ts';
import { world } from './world.ts';

export let S = 3; // whole-number scale the office is drawn at; a live binding office.ts reads every frame

let canvas: HTMLCanvasElement,
  barEl: HTMLElement,
  stageEl: HTMLElement,
  sideOpen: () => boolean,
  onResized: () => void;
let PANEL_W = 0,
  PANEL_ANIM_MS = 0; // read from style.css (--panel-w / --panel-ms) so the two can't drift apart
/**
 * Wire the canvas; once, before anything resizes. sideOpen(): the panel or the editor covers the right edge;
 * onResized(): the office was fit again, so the scale or its pin (zoomInfo()) may have changed.
 */
export function initViewport(o: {
  canvas: HTMLCanvasElement;
  barEl: HTMLElement;
  stageEl: HTMLElement;
  sideOpen: () => boolean;
  onResized: () => void;
}) {
  ({ canvas, barEl, stageEl, sideOpen, onResized } = o);
  const css = getComputedStyle(document.documentElement);
  PANEL_W = parseInt(css.getPropertyValue('--panel-w'), 10);
  PANEL_ANIM_MS = parseInt(css.getPropertyValue('--panel-ms'), 10);
  const z = Math.round(Number(storage.get('pawgents.zoom')));
  zoom = z >= 1 ? Math.min(z, MAX_SCALE) : null;
  window.addEventListener('resize', resize);
}
// Width the open panel takes from the office. On narrow windows the panel just covers it.
const panelRoom = () =>
  sideOpen() && window.innerWidth >= PANEL_W * 2 ? PANEL_W : 0;

// Whole-number zoom, like pixel-art games: every art pixel is the same size on screen. Fit: at least MIN_SCALE, more
// when the window has room; an office bigger than the window scrolls instead of shrinking its pixels. The −/+ buttons
// pin a zoom instead (remembered per browser); the zoom button between them goes back to fitting.
const MIN_SCALE = 2,
  MAX_SCALE = 8;
let zoom: number | null = null; // pinned scale, or null: fit the window (initViewport reads the saved one)
function fitScale() {
  if (zoom) return zoom;
  const ticker = $('ticker');
  const availW = window.innerWidth - 16 - panelRoom();
  const availH =
    window.innerHeight -
    12 -
    (ticker.hidden ? 0 : ticker.offsetHeight) -
    barEl.offsetHeight;
  return clamp(
    Math.floor(Math.min(availW / world.view.W, availH / world.view.VIEW_H)),
    MIN_SCALE,
    MAX_SCALE,
  );
}
/** Pin a scale (the −/+ buttons), or null: fit the window again. */
export function setZoom(z: number | null) {
  zoom = z ? clamp(z, 1, MAX_SCALE) : null;
  if (zoom) storage.set('pawgents.zoom', zoom);
  else storage.remove('pawgents.zoom');
  resize();
}
/** What the zoom buttons show: the scale drawn at, whether it is pinned, and the largest there is. */
export const zoomInfo = () => ({
  scale: S,
  pinned: !!zoom,
  max: MAX_SCALE,
});

/** The ticker (bottom) and the panel (right) float over the page: pad the page so the office can scroll out from under them. */
export function placeTicker() {
  const ticker = $('ticker'),
    side = sideOpen() ? Math.min(PANEL_W, window.innerWidth) : 0;
  ticker.style.right = `${side}px`;
  stageEl.style.paddingBottom = `${(ticker.hidden ? 0 : ticker.offsetHeight) + 4}px`;
  stageEl.style.paddingRight = `${side + 4}px`;
}

/** Fit the office to the window at once (backing store + CSS size). */
export function resize() {
  clearTimeout(refitTimer);
  canvas.classList.remove('refit');
  S = fitScale();
  canvas.width = Math.round(world.view.W * S);
  canvas.height = Math.round(world.view.VIEW_H * S);
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  barEl.style.width = canvas.style.width;
  onResized();
  placeTicker();
}

/**
 * Panel opened/closed: ease the CSS size toward the new fit (left edge stays put while it grows
 * or shrinks), then re-rasterize at that size so pixels and text are crisp again.
 */
let refitTimer: ReturnType<typeof setTimeout> | undefined;
export function refit() {
  placeTicker();
  const s = fitScale();
  if (s === S && !canvas.classList.contains('refit')) return;
  canvas.classList.add('refit');
  canvas.style.width = `${Math.round(world.view.W * s)}px`;
  canvas.style.height = `${Math.round(world.view.VIEW_H * s)}px`;
  barEl.style.width = canvas.style.width;
  clearTimeout(refitTimer);
  refitTimer = setTimeout(resize, PANEL_ANIM_MS + 20);
}

/** Pointer position in office (unscaled) pixels; CSS size can differ from the backing store mid-refit. */
export function officeXY(ev: MouseEvent): [number, number] {
  const k = canvas.width / (canvas.clientWidth || canvas.width);
  return [(ev.offsetX * k) / S, (ev.offsetY * k) / S - WALL_RISE];
}
/** Viewport position just under the HUD's left edge (`b`: the HUD button's rect, office px). */
export function rosterAnchor(b: Rect) {
  const r = canvas.getBoundingClientRect(),
    k = r.width / canvas.width;
  return {
    left: r.left + b.x * S * k,
    top: r.top + (b.y + b.h + WALL_RISE + 2) * S * k,
  };
}
