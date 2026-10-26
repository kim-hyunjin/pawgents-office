// Uploaded sprite sheets: ids and upload validation. Grid rules live in web/limits.js (skinGridError), shared with the upload dialog.

import { MAX_SKIN_BYTES, skinGridError } from '../shared/limits.ts';
import type { Skin } from './types.ts';

export const SKIN_ID = /^[a-z0-9]{10}$/;
/** The name of a saved skin that has none. */
export const DEFAULT_SKIN_NAME = '스킨';
export const hasSkin = (skins: Pick<Skin, 'id'>[], id: string) =>
  skins.some((k) => k.id === id);

/** A random id no skin in `skins` has yet. */
export function newSkinId(skins: Pick<Skin, 'id'>[]) {
  let id: string;
  do
    id = Array.from(
      { length: 10 },
      () =>
        'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
    ).join('');
  while (hasSkin(skins, id));
  return id;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Checks an uploaded sheet; returns an error message, or null when it's usable. */
export function skinError(png: Buffer, cellW: number, cellH: number) {
  if (!png.length) return 'PNG 파일이 비어 있습니다.';
  if (png.length > MAX_SKIN_BYTES)
    return `파일이 너무 큽니다(최대 ${MAX_SKIN_BYTES / 1024}KB).`;
  if (
    png.length < 24 ||
    !png.subarray(0, 8).equals(PNG_SIG) ||
    png.toString('latin1', 12, 16) !== 'IHDR'
  )
    return 'PNG 파일이 아닙니다.';
  return skinGridError(
    png.readUInt32BE(16),
    png.readUInt32BE(20),
    cellW,
    cellH,
  );
}
