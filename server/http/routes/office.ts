// The office editor and switcher: layout, reset, rename, close, and everyone in one office.
import { NO_OFFICE, type OfficeActions } from '../../app/offices.ts';
import { json, readJson, sendRefusal } from '../../http.ts';
import type { Store } from '../../store.ts';
import type { Route, RouteCtx } from './types.ts';

export function officeRoutes({
  store,
  offices,
}: {
  store: Store;
  offices: OfficeActions;
}): Route[] {
  // The office routes read the body first, so 403 / 413 / 400 win over a 404 for an unknown office.
  const officeCtx = async ({ req, res, params: [id] }: RouteCtx) => {
    const office = store.office(id);
    const data = await readJson(req, res);
    if (!data) return null;
    if (!office) {
      json(res, 404, { error: NO_OFFICE });
      return null;
    }
    return { office, data };
  };
  /** Run an office action on the office the path names; refusals answer as errors, success as { ok: true }. */
  const officeRoute =
    (act: (o: NonNullable<Awaited<ReturnType<typeof officeCtx>>>) => void) =>
    async (ctx: RouteCtx) => {
      const o = await officeCtx(ctx);
      if (!o) return;
      try {
        act(o);
      } catch (e) {
        sendRefusal(ctx.res, e);
        return;
      }
      json(ctx.res, 200, { ok: true });
    };

  return [
    [
      'POST',
      '/settings/together',
      async ({ req, res }) => {
        const data = await readJson(req, res);
        if (!data) return;
        try {
          offices.setTogether(
            data.officeId == null ? null : String(data.officeId),
          );
        } catch (e) {
          sendRefusal(res, e);
          return;
        }
        json(res, 200, { ok: true });
      },
    ],
    [
      'POST',
      /^\/offices\/([^/]+)\/layout$/,
      officeRoute(({ office, data }) =>
        offices.saveLayout(office, data.layout),
      ),
    ],
    [
      'POST',
      /^\/offices\/([^/]+)\/reset$/,
      officeRoute(({ office }) => offices.resetLayout(office)),
    ],
    [
      'POST',
      /^\/offices\/([^/]+)$/,
      officeRoute(({ office, data }) =>
        offices.rename(office, String(data.name ?? '').trim()),
      ),
    ],
    [
      'DELETE',
      /^\/offices\/([^/]+)$/,
      officeRoute(({ office }) => offices.close(office)),
    ],
  ];
}
