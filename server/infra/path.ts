// Path comparison keys. Two shapes on purpose:
//   normalizePath  for comparing paths from mixed sources (git prints forward slashes, Node backslashes):
//                  slash style and trailing slashes don't matter, case doesn't on Windows.
//   foldCase       for a path that is already `path.resolve`d and used as-is afterwards (repo.ts's office key is
//                  persisted and opened as a directory), so it keeps its native separators and only drops case.

import { isWindows, type Platform } from './platform.ts';

/** Lowercased on Windows, untouched elsewhere. */
export const foldCase = (p: string, platform: Platform = process.platform) =>
  isWindows(platform) ? p.toLowerCase() : p;

/** Forward slashes, no trailing slash; case kept. Nullish → ''. */
export const slashPath = (p: unknown) =>
  String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');

/** A comparison key: slash style, trailing slash and (on Windows) case ignored. */
export const normalizePath = (
  p: unknown,
  platform: Platform = process.platform,
) => foldCase(slashPath(p), platform);

/** The same path once normalized. */
export const samePath = (
  a: unknown,
  b: unknown,
  platform: Platform = process.platform,
) => normalizePath(a, platform) === normalizePath(b, platform);
