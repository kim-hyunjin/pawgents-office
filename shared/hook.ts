// What hooks/send.ts posts to the server's /hook. Types only.

/** A tool call's input as Claude Code sends it: dynamic JSON, shape depends on the tool. */
export type ToolInput = Record<string, unknown>;

/** A Claude Code hook payload (after hooks/send.ts shrank it). Only the fields the server reads are named. */
export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  permission_mode?: string;
  orca_terminal?: string;
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  tool_use_id?: string;
  tool_response_head?: string;
  tool_response_len?: number;
  duration_ms?: number;
  prompt?: string;
  message?: string;
  error?: string;
  reason?: string;
  trigger?: string;
  source?: string;
  model?: string;
  session_title?: string;
  notification_type?: string;
  last_assistant_message?: string;
  background_tasks?: {
    id?: string;
    type?: string;
    status?: string;
    description?: string;
    command?: string;
  }[];
  from_model?: string;
  to_model?: string;
  await_decision?: boolean;
  [key: string]: unknown;
}

/** The server's answer to a `--decide` PermissionRequest (padded with heartbeat spaces while it waits). */
export interface DecisionReply {
  decision?: 'allow' | 'deny';
  message?: string;
}
