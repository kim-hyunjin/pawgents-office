// Permission decisions for headless sessions (pure: shared by the hook, the server and tests).
// The plugin's own PermissionRequest hook stays `async: true` (it can't decide, so interactive sessions never wait on the
// office). Headless claude gets a second, synchronous copy through `--settings`, marked with DECIDE_FLAG: that one
// long-polls the office server and prints the browser's answer.
export const DECIDE_FLAG = '--decide';
export const DECISION_TIMEOUT_S = 1800; // claude kills the hook after this; the server answers "no decision" a bit earlier

/** Hook stdout that answers a PermissionRequest. No output at all means "no decision" (denied under --permission-prompts none). */
export const decisionOutput = (
  allow: boolean,
  message: string | undefined = '사용자가 사무실에서 거부했습니다.',
) => ({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: allow ? { behavior: 'allow' } : { behavior: 'deny', message },
  },
});

/** `--settings` content for headless claude: one synchronous PermissionRequest hook running `command`. */
export const headlessSettings = (command: string) => ({
  hooks: {
    PermissionRequest: [
      { hooks: [{ type: 'command', command, timeout: DECISION_TIMEOUT_S }] },
    ],
  },
});
