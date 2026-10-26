// How the cats look: a breed per model family, and uploaded sprite sheets (upload, image, delete).
import type { SkinActions } from '../../app/skins.ts';
import { json, notFound, readJson, sendRefusal } from '../common.ts';
import { sendFile } from '../static.ts';
import type { Route } from './types.ts';

export const skinRoutes = ({ skins }: { skins: SkinActions }): Route[] => [
  [
    'POST',
    '/settings/cats',
    async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const fam = String(data.family || ''),
        breed = data.breed == null ? null : String(data.breed);
      let cats: Record<string, string>;
      try {
        cats = skins.setCat(fam, breed);
      } catch (e) {
        sendRefusal(res, e);
        return;
      }
      json(res, 200, { ok: true, cats });
    },
  ],
  [
    'POST',
    '/skins',
    async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const png = Buffer.from(
        String(data.png ?? '').replace(/^data:image\/png;base64,/, ''),
        'base64',
      );
      try {
        const skin = skins.upload({
          name: String(data.name ?? '').trim(),
          cellW: Number(data.cellW),
          cellH: Number(data.cellH),
          png,
        });
        json(res, 200, { ok: true, skin });
      } catch (e) {
        sendRefusal(res, e);
      }
    },
  ],
  [
    'GET',
    /^\/skins\/([a-z0-9]{10})\.png$/,
    ({ res, params: [id] }) => {
      const file = skins.imageOf(id);
      if (!file) {
        notFound(res);
        return;
      }
      // ids are never reused, so the image under one can be cached for good
      sendFile(res, file, null, {
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'max-age=31536000, immutable',
      });
    },
  ],
  [
    'POST',
    /^\/skins\/([a-z0-9]{10})\/delete$/,
    async ({ req, res, params: [id] }) => {
      if (!(await readJson(req, res))) return; // body unused, but a same-origin JSON POST is the CSRF guard
      try {
        skins.remove(id);
      } catch (e) {
        sendRefusal(res, e);
        return;
      }
      json(res, 200, { ok: true });
    },
  ],
];
