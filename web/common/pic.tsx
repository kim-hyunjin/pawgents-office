// A sprite frame (or skin frame) on a canvas of its own, as a component: pic() in ui.ts, redrawn when the image changes.
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Sprite } from '../scene/sprites.ts';
import { pic } from './ui.ts';

export function Pic({
  img,
  zoom = 1,
  class: cls,
}: {
  /** undefined: nothing to draw yet (the canvas stays 0×0, not a bare canvas's 300×150). */
  img: Sprite | HTMLCanvasElement | ImageBitmap | undefined;
  zoom?: number;
  class?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (img && ref.current) pic(img, zoom, ref.current);
  }, [img, zoom]);
  // pic() sizes the canvas; Preact leaves width / height alone after the first render
  return <canvas class={cls} width={0} height={0} ref={ref} />;
}
