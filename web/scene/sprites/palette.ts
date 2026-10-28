// Which cat a session gets: model → family → the user's breed (or skin) choice → a coat variant by session id.
import type { Palette } from './data.ts';
import { BREEDS, FAMILIES } from './data.ts';
import { skins } from './skins.ts';

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let chosen: Record<string, string> = {}; // family -> breed key, set by the user (server-persisted, see office.ts)
export function setBreedChoices(map?: Record<string, string> | null) {
  chosen = { ...(map || {}) };
}
/** What the user picked for a family (a skin may still be loading), or the default breed. */
export function choiceOf(fam: string) {
  return chosen[fam] || defaultBreed(fam);
}
/** A family's own breed (familyOf names only known families; anything else is drawn like 'other'). */
const defaultBreed = (fam: string) => (FAMILIES[fam] ?? FAMILIES.other).breed;
/** The breed a model family's cats are drawn as: the user's pick if it's a known breed or a loaded skin, else the default. */
export function breedOf(fam: string) {
  const k = chosen[fam];
  const sid = skinId(k);
  return k && (BREEDS[k] || (sid !== null && skins.get(sid)?.rows))
    ? k
    : defaultBreed(fam);
}
const skinId = (k: unknown) =>
  typeof k === 'string' && k.startsWith('skin:') ? k.slice(5) : null;

export function familyOf(model?: string | null) {
  const m = String(model || '').toLowerCase();
  if (/fable|mythos/.test(m)) return 'fable';
  if (/opus/.test(m)) return 'opus';
  if (/sonnet/.test(m)) return 'sonnet';
  if (/haiku/.test(m)) return 'haiku';
  return 'other';
}
/** The model's family: its label, title, default breed and monitor (an unknown model is 'other'). */
export const familyInfo = (model?: string | null) =>
  FAMILIES[familyOf(model)] ?? FAMILIES.other;

export function paletteFor(
  id: string,
  kind = 'employee',
  model: string | null = null,
): Palette {
  const fam = familyOf(model),
    breed = breedOf(fam);
  return breedPalette(
    breed,
    (hashStr(id) >>> 4) % (BREEDS[breed]?.coats.length || 1),
    kind,
    fam,
  );
}
/** Palette for one specific coat variant of a breed (a skin has just the one look). */
export function breedPalette(
  breed: string,
  variant: number,
  kind = 'employee',
  fam: string | null = null,
): Palette {
  const sid = skinId(breed);
  if (sid) return { fam, breed, skin: sid, variant: 0, kind };
  const b = BREEDS[breed]; // callers pass a known breed (breedOf checks the user's pick)
  return {
    fam,
    breed,
    variant,
    kind,
    shape: b?.shape,
    ...b?.coats[variant],
    W: '#fdfdfd',
    L: '#c8d0d8',
    D: '#111',
  };
}
