// server/backends/orca.ts: what the Orca backend reads off a rendered terminal screen (the footer's mode, dialogs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDialog, pickOption } from '../server/backends/orca.ts';

test('Orca footerMode reads the mode line under the input box', async () => {
  const { footerMode } = await import('../server/backends/orca.ts');
  const box = [
    '● some answer that says plan mode on',
    '─'.repeat(60),
    '> ',
    '─'.repeat(60),
  ];
  assert.equal(
    footerMode([...box, '  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent']),
    'auto',
  );
  assert.equal(
    footerMode([...box, '  ⏵⏵ accept edits on (shift+tab to cycle)']),
    'acceptEdits',
  );
  assert.equal(
    footerMode([...box, '  ⏸ plan mode on (shift+tab to cycle)']),
    'plan',
  );
  assert.equal(
    footerMode([...box, '  ⏵⏵ bypass permissions on (shift+tab to cycle)']),
    'bypassPermissions',
  );
  assert.equal(
    footerMode([...box, '  ⏸ manual mode on · ← 1 agent']),
    'default',
  );
  assert.equal(footerMode([...box, '  ? for shortcuts']), 'default'); // the answer above the box doesn't count
  assert.equal(footerMode(['Select model', '❯ 1. Opus']), null); // no input box on screen
});

// ---- answering the dialog from the office: screens captured from a real Orca terminal (claude 2.1.309) ----
const DASH = '╌'.repeat(60);
const BASH_SCREEN = [
  '● some earlier answer',
  '────────────────────────────────────────',
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  ' Write capture-b to scratchpad file',
  DASH,
  ' │ echo capture-b > C:/x/scratchpad/cap-b.txt',
  DASH,
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to C:UsershjkimAppDataLocalTempclaudescratchpad',
  '      from this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  ' Esc to cancel · Tab to amend',
];
const WRITE_SCREEN = [
  ' Create file',
  ' ....AppDataLocalTempscratchpadcap-w.txt',
  DASH,
  '  1 hello',
  DASH,
  ' Do you want to create cap-w.txt?',
  ' ❯ 1. Yes',
  '   2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session; Yes, and always allow access to',
  '      C:UsershjkimAppDataLocalTempscratchpad for this session (shift+tab)',
  '   3. No',
  ' Esc to cancel · Tab to amend',
];
const FETCH_SCREEN = [
  ' Fetch · from the web-fetch agent',
  ' Claude wants to fetch content from example.com',
  DASH,
  ' url: https://example.com/',
  ' │ prompt: What is the title?',
  DASH,
  ' Do you want to allow Claude to fetch this content?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for example.com",
  '   3. No, and tell Claude what to do differently (esc)',
];
const QUESTION_SCREEN = [
  '❯ Use the AskUserQuestion tool',
  '────────────────────────────────────────',
  ' ☐ Color',
  'Which color do you like?',
  '❯ 1. Red',
  '     Choose red',
  '  2. Blue',
  '     Choose blue',
  '  3. Type something.',
  '────────────────────────────────────────',
  '  4. Chat about this',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
];

test('parseDialog + pickOption: the key is whichever number is the plain Yes / No', () => {
  const bash = parseDialog(BASH_SCREEN);
  assert.equal(bash!.question, 'Do you want to proceed?');
  assert.deepEqual(
    bash!.options.map((o) => o.n),
    [1, 2, 3, 4],
  ); // the wrapped label is not an option
  assert.deepEqual([pickOption(bash, true), pickOption(bash, false)], [1, 4]);
  const write = parseDialog(WRITE_SCREEN);
  assert.deepEqual([pickOption(write, true), pickOption(write, false)], [1, 3]); // same dialog, "No" is 3 here
  const fetch = parseDialog(FETCH_SCREEN);
  assert.deepEqual([pickOption(fetch, true), pickOption(fetch, false)], [1, 3]); // "No, and tell Claude what to do differently (esc)"
});

test('parseDialog: no dialog, or one with no plain Yes / No, gives no key', () => {
  assert.equal(
    parseDialog(['● done', '────', '❯ ', '────', '  ⏸ manual mode on']),
    null,
  );
  assert.equal(parseDialog([]), null);
  assert.equal(pickOption(parseDialog(QUESTION_SCREEN), true), null); // choices, not a permission dialog
  assert.equal(pickOption(parseDialog(QUESTION_SCREEN), false), null);
  // "Yes, and always …" is never taken for a plain Yes
  assert.equal(
    pickOption(
      {
        question: '',
        options: [
          { n: 1, label: 'Yes, and always allow' },
          { n: 2, label: 'No' },
        ],
      },
      true,
    ),
    null,
  );
  // a list that does not start at 1 is something else (scrolled, or a numbered answer in the transcript)
  assert.equal(parseDialog(['text', '  2. Yes', '  3. No']), null);
});
