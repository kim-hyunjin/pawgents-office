// The shape Claude Code settings use to register a hook (pure: for hooks/install.ts and shared/decision.ts).

/** One command handler inside a hook group. */
export interface CommandHook {
  type: 'command';
  command: string;
  async?: boolean;
  timeout?: number;
}

/** A hook group that runs `command`: what settings.hooks[event] lists. `opts` follow `command` in the JSON. */
export const commandGroup = (
  command: string,
  opts: Pick<CommandHook, 'async' | 'timeout'> = {},
): { hooks: CommandHook[] } => ({
  hooks: [{ type: 'command', command, ...opts }],
});
