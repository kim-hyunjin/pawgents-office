// server/infra/path.ts and platform.ts on both platforms, by passing the platform in.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  foldCase,
  normalizePath,
  samePath,
  slashPath,
} from '../server/infra/path.ts';
import { isWindows } from '../server/infra/platform.ts';

test('isWindows: only win32', () => {
  assert.equal(isWindows('win32'), true);
  assert.equal(isWindows('linux'), false);
  assert.equal(isWindows('darwin'), false);
});

test('slashPath: forward slashes, no trailing slash, case kept, nullish → empty', () => {
  assert.equal(slashPath('C:\\Repo\\Sub\\'), 'C:/Repo/Sub');
  assert.equal(slashPath('/home/me/Repo//'), '/home/me/Repo');
  assert.equal(slashPath(undefined), '');
  assert.equal(slashPath(null), '');
  assert.equal(slashPath(''), '');
});

test('normalizePath: case folded on win32 only', () => {
  assert.equal(normalizePath('C:\\Repo\\Sub\\', 'win32'), 'c:/repo/sub');
  assert.equal(normalizePath('C:\\Repo\\Sub\\', 'linux'), 'C:/Repo/Sub');
  assert.equal(normalizePath('/Home/Me/', 'darwin'), '/Home/Me');
});

test('samePath: slash style and trailing slash never matter, case only on win32', () => {
  assert.equal(samePath('C:\\Repo\\a', 'c:/repo/a/', 'win32'), true);
  assert.equal(samePath('C:\\Repo\\a', 'c:/repo/a/', 'linux'), false);
  assert.equal(samePath('/x/Repo', '/x/Repo/', 'linux'), true);
  assert.equal(samePath('/x/a', '/x/b', 'win32'), false);
  assert.equal(samePath(undefined, '', 'linux'), true);
});

test('foldCase: keeps separators, lowercases on win32 only', () => {
  assert.equal(foldCase('C:\\Repo\\', 'win32'), 'c:\\repo\\');
  assert.equal(foldCase('/Home/Repo', 'linux'), '/Home/Repo');
});
