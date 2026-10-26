// What a launch / mode change may ask claude for: checked by the server, offered by the browser.

export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
];
export const MODEL_RE = /^[\w.\-[\]]{1,80}$/;
