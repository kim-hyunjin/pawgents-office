// Offices and desks as rules over plain data: which office a repo gets, which desk a session sits at. No I/O:
// the repo of a working directory comes from an injected RepoResolver (git, in server/repo.ts).
import type { Layout } from '../../shared/layout.ts';
import { cloneOffice, DEFAULT_OFFICE } from '../../shared/layout.ts';
import type { DeskMemory, Office } from '../types.ts';

export const DEFAULT_OFFICE_ID = 'default';
/** The name of the default office, and of a repo's office when the repo has none. */
export const DEFAULT_OFFICE_NAME = '사무실';
/** The repo key of every working directory outside a git repo (they share the default office). */
export const NO_REPO = 'default';

/** Which repo a working directory belongs to: its key (offices list these) and a display name. */
export interface Repo {
  key: string;
  name: string;
}
export type RepoResolver = (cwd?: string | null) => Repo;

export const newOffice = (
  id: string,
  name: string,
  repos: string[],
  layout: Layout = cloneOffice(DEFAULT_OFFICE),
): Office => ({ id, name, repos, layout });
export const defaultOffice = () =>
  newOffice(DEFAULT_OFFICE_ID, DEFAULT_OFFICE_NAME, [NO_REPO]);
/** A fresh office id: time-ordered, with a random tail. */
export const newOfficeId = () =>
  `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The office of `repo`, if one lists it. */
export const officeOfRepo = (offices: Office[], repo: Repo) =>
  offices.find((x) => x.repos.includes(repo.key));

/**
 * The desk a session gets in an office with `n` desks, where `used` are taken: the remembered one if it is still
 * there and free (layouts can shrink), else the lowest free one. Past the last desk: standing in the lobby.
 */
export function pickDesk(
  used: Set<number | null>,
  n: number,
  officeId: string | null,
  remembered: DeskMemory | undefined,
) {
  if (
    remembered &&
    (remembered.office ?? DEFAULT_OFFICE_ID) === officeId &&
    remembered.desk < n &&
    !used.has(remembered.desk)
  )
    return remembered.desk;
  let desk = 0;
  while (used.has(desk)) desk++;
  return desk;
}

/** Fold `office`'s repos into `home` (an office closing), skipping those it already has. */
export function absorbRepos(home: Office, office: Office) {
  home.repos.push(...office.repos.filter((r) => !home.repos.includes(r)));
}
