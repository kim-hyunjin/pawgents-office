// The look of the office: which breed each model family is drawn as, and the uploaded sprite sheets.
import fs from 'node:fs';
import path from 'node:path';
import { isCatFamily } from '../../shared/model.ts';
import { hasSkin, newSkinId, SKIN_ID } from '../skins.ts';
import type { Skin } from '../types.ts';
import type { EventBus } from './events.ts';

// a built-in breed (the list itself lives in web/sprites.js) or an uploaded skin, 'skin:<id>'
export const BREED_KEY = /^([a-z]{2,24}|skin:[a-z0-9]{10})$/;

export class SettingsRepo {
  cats: Record<string, string>;
  skins: Skin[];
  skinsDir: string;
  events: EventBus;
  save: () => void;

  constructor({
    skinsDir,
    events,
    save,
  }: {
    skinsDir: string;
    events: EventBus;
    save: () => void;
  }) {
    this.cats = {}; // model family -> breed key the user picked (absent = default breed)
    this.skins = []; // uploaded sprite sheets: { id, name, cellW, cellH }, image at skinsDir/<id>.png
    this.skinsDir = skinsDir;
    this.events = events;
    this.save = save;
  }

  loadSkins(skins: any) {
    this.skins = [];
    for (const k of Array.isArray(skins) ? skins : []) {
      if (
        SKIN_ID.test(k?.id) &&
        !hasSkin(this.skins, k.id) &&
        fs.existsSync(this.skinFile(k.id))
      ) {
        this.skins.push({
          id: k.id,
          name: String(k.name || '스킨'),
          cellW: k.cellW,
          cellH: k.cellH,
        });
      }
    }
  }
  /** After loadSkins: a pick of a skin that is gone is dropped. */
  loadCats(cats: any) {
    this.cats = {};
    for (const [fam, breed] of Object.entries(
      (cats || {}) as Record<string, any>,
    )) {
      if (isCatFamily(fam) && BREED_KEY.test(breed) && this.hasBreed(breed))
        this.cats[fam] = breed;
    }
  }

  /** Pick the breed a model family is drawn as; null restores the default. Pushed to every browser. */
  setCat(fam: string, breed: string | null) {
    if (breed) this.cats[fam] = breed;
    else delete this.cats[fam];
    this.commit();
  }
  emit() {
    this.events.emit('settings', { cats: this.cats, skins: this.skins });
  }
  /** Persist and push the cat / skin settings after a change. */
  commit() {
    this.save();
    this.emit();
  }
  skinFile(id: string) {
    return path.join(this.skinsDir, `${id}.png`);
  }
  /** Skins must exist; built-in breed keys are checked by the browser (unknown ones draw the default). */
  hasBreed(breed: string) {
    return !breed.startsWith('skin:') || hasSkin(this.skins, breed.slice(5));
  }
  /** Store an uploaded sprite sheet (already validated) and offer it to every browser. */
  addSkin({ name, cellW, cellH }: Omit<Skin, 'id'>, png: Buffer) {
    const id = newSkinId(this.skins);
    fs.mkdirSync(this.skinsDir, { recursive: true });
    fs.writeFileSync(this.skinFile(id), png);
    const skin: Skin = { id, name, cellW, cellH };
    this.skins.push(skin);
    this.commit();
    return skin;
  }
  /** Delete a skin; families drawn with it go back to their default breed. */
  removeSkin(id: string) {
    if (!hasSkin(this.skins, id)) return false;
    this.skins = this.skins.filter((k) => k.id !== id);
    for (const [fam, breed] of Object.entries(this.cats))
      if (breed === `skin:${id}`) delete this.cats[fam];
    try {
      fs.unlinkSync(this.skinFile(id));
    } catch {
      /* already gone */
    }
    this.commit();
    return true;
  }
}
