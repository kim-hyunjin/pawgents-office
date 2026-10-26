// How the cats look: a breed per model family, and uploaded sprite sheets.
import fs from 'node:fs';
import {
  isCell,
  isName,
  MAX_CELL,
  MAX_NAME_CHARS,
  MIN_CELL,
} from '../../shared/limits.ts';
import { isCatFamily } from '../../shared/model.ts';
import { hasSkin, skinError } from '../skins.ts';
import type { Store } from '../store.ts';
import { BREED_KEY } from '../store.ts';
import { BAD_REQUEST, invalid, notFound } from './errors.ts';
import type { Logger } from './ports.ts';

export function createSkinActions({
  store,
  logger,
}: {
  store: Store;
  logger: Logger;
}) {
  return {
    /** Draw model family `fam` as `breed` (null: its default). Resolves with every pick. */
    setCat(fam: string, breed: string | null) {
      if (
        !isCatFamily(fam) ||
        (breed !== null && (!BREED_KEY.test(breed) || !store.hasBreed(breed)))
      )
        throw invalid(BAD_REQUEST);
      store.setCat(fam, breed);
      return store.cats;
    },
    /** Check and keep an uploaded sprite sheet. */
    upload({
      name,
      cellW,
      cellH,
      png,
    }: {
      name: string;
      cellW: number;
      cellH: number;
      png: Buffer;
    }) {
      if (!isName(name))
        throw invalid(`스킨 이름은 1–${MAX_NAME_CHARS}자여야 합니다.`);
      if (!isCell(cellW) || !isCell(cellH))
        throw invalid(`칸 크기는 ${MIN_CELL}–${MAX_CELL}px이어야 합니다.`);
      const err = skinError(png, cellW, cellH);
      if (err) throw invalid(err);
      const skin = store.addSkin({ name, cellW, cellH }, png);
      logger.info(`[web] skin uploaded: ${name} (${skin.id})`);
      return skin;
    },
    /** The image file of skin `id`, or null when there is none. */
    imageOf(id: string) {
      const file = hasSkin(store.skins, id) ? store.skinFile(id) : null;
      return file && fs.existsSync(file) ? file : null;
    },
    remove(id: string) {
      if (!store.removeSkin(id)) throw notFound('없는 스킨입니다.');
    },
  };
}
export type SkinActions = ReturnType<typeof createSkinActions>;
