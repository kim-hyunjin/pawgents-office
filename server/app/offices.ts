// The office editor and switcher: layouts, names, closing an office, everyone in one office.
import {
  cloneOffice,
  DEFAULT_OFFICE,
  normalize,
  validate,
} from '../../shared/layout.ts';
import { isName, MAX_NAME_CHARS } from '../../shared/limits.ts';
import { DEFAULT_OFFICE_ID } from '../domain/office.ts';
import type { Store } from '../store.ts';
import type { Office } from '../types.ts';
import { invalid, notFound } from './errors.ts';
import type { Logger } from './ports.ts';

export const NO_OFFICE = '사무실이 없습니다.';

export function createOfficeActions({
  store,
  logger,
}: {
  store: Store;
  logger: Logger;
}) {
  return {
    /** Everyone in office `id`, or (null) each repo in its own office again. */
    setTogether(id: string | null) {
      if (id !== null && !store.office(id)) throw notFound(NO_OFFICE);
      store.setTogether(id);
      logger.info(
        `[web] ${id ? `everyone works in ${store.office(id)!.name}` : 'back to one office per repo'}`,
      );
    },
    /** Save an edited layout (as sent: normalized and checked here). */
    saveLayout(office: Office, raw: unknown) {
      const layout = normalize(raw),
        errs = validate(layout);
      if (errs.length) throw invalid(errs.map((e) => e.msg).join(' / '));
      store.setLayout(office.id, layout!);
      logger.info(`[web] layout saved: ${office.name}`);
    },
    resetLayout(office: Office) {
      store.setLayout(office.id, cloneOffice(DEFAULT_OFFICE));
    },
    rename(office: Office, name: string) {
      if (!isName(name))
        throw invalid(`사무실 이름은 1–${MAX_NAME_CHARS}자여야 합니다.`);
      store.renameOffice(office.id, name);
    },
    /** Close an office (not the default one): its repos and staff move to the default office. */
    close(office: Office) {
      if (office.id === DEFAULT_OFFICE_ID)
        throw invalid('기본 사무실은 닫을 수 없습니다.');
      store.deleteOffice(office.id);
      logger.info(`[web] office closed: ${office.name}`);
    },
  };
}
export type OfficeActions = ReturnType<typeof createOfficeActions>;
