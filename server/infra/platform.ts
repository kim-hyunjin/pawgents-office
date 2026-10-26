// The one place server/infra asks which OS it runs on; pass `platform` in to test the other one.

export type Platform = NodeJS.Platform;

/** Windows: case-insensitive paths, backslashes. */
export const isWindows = (platform: Platform = process.platform) =>
  platform === 'win32';
