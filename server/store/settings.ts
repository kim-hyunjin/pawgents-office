// The look of the office: which breed each model family is drawn as, and the uploaded sprite sheets.
import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from '../../shared/json.ts';
import { isCatFamily } from '../../shared/model.ts';
import { DEFAULT_SKIN_NAME, hasSkin, newSkinId, SKIN_ID } from '../skins.ts';
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

  /** Saved skins (state.json `skins`): ones whose id looks like a skin id, first of an id, with the image on disk. */
  loadSkins(skins: unknown) {
    this.skins = [];
    for (const k of Array.isArray(skins) ? skins : []) {
      if (!isRecord(k)) continue;
      // fields are kept as saved: addSkin checked them, SKIN_ID only looks at the id's text
      const id = k.id as string;
      if (
        SKIN_ID.test(String(id)) &&
        !hasSkin(this.skins, id) &&
        fs.existsSync(this.skinFile(id))
      ) {
        this.skins.push({
          id,
          name: String(k.name || DEFAULT_SKIN_NAME),
          cellW: k.cellW as number,
          cellH: k.cellH as number,
        });
      }
    }
  }
  /** Saved picks (state.json `cats`): a known family and a breed key; after loadSkins, as a pick of a gone skin is dropped. */
  loadCats(cats: unknown) {
    this.cats = {};
    for (const [fam, breed] of Object.entries(isRecord(cats) ? cats : {})) {
      if (
        isCatFamily(fam) &&
        typeof breed === 'string' &&
        BREED_KEY.test(breed) &&
        this.hasBreed(breed)
      )
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
