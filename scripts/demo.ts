#!/usr/bin/env bun
// Replays a fake Claude Code hook sequence against a running pawgents-office server,
// so the office can be developed and demoed without a live claude session.
//   bun scripts/demo.ts [--loop] [--speed 1] [--port 17777]
import type { Snapshot } from '../shared/api.ts';
import { errMessage } from '../shared/errors.ts';
import type { HookEvent, ToolInput } from '../shared/hook.ts';
import { PORT as DEFAULT_PORT, HOST } from '../shared/node/env.ts';
import { postHook } from '../shared/node/hook-client.ts';

const args = process.argv.slice(2);
const flag = (n: string, d: string | number) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const LOOP = args.includes('--loop');
const SPEED = Number(flag('--speed', 1));
const PORT = Number(flag('--port', DEFAULT_PORT));
const BASE = `http://${HOST}:${PORT}`; // not config's BASE_URL: --port may override

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / SPEED));

// Sessions that got a SessionStart but no SessionEnd yet. When the demo is stopped
// (Ctrl+C, kill, or the terminal closing) every one of them is sent home, so the
// office is not left with employees that will never clock out.
type Ev = HookEvent & { session_id: string; hook_event_name: string }; // a fake hook payload
type Base = Pick<
  Ev,
  'session_id' | 'cwd' | 'transcript_path' | 'permission_mode'
>;
const active = new Map<string, Base>(); // session_id -> base event fields
let stopping = false;

async function send(ev: Ev) {
  if (stopping && ev.hook_event_name !== 'SessionEnd') return;
  if (ev.hook_event_name === 'SessionStart')
    active.set(ev.session_id, {
      session_id: ev.session_id,
      cwd: ev.cwd,
      transcript_path: ev.transcript_path,
      permission_mode: ev.permission_mode,
    });
  if (ev.hook_event_name === 'SessionEnd') active.delete(ev.session_id);
  try {
    await postHook(ev, { baseUrl: BASE });
    const t = ev.tool_name ? ` ${ev.tool_name}` : '';
    console.log(
      `${ev.session_id.padEnd(12)} ${ev.hook_event_name}${t}${ev.agent_id ? ` (agent ${ev.agent_id})` : ''}`,
    );
  } catch (e) {
    console.error('send failed:', errMessage(e), '— is the server running?');
  }
}

function script(
  sid: string,
  cwd: string,
  agentId: string,
  finalText: string,
  model = 'claude-fable-5-1',
): [number, Ev][] {
  const base: Base = {
    session_id: sid,
    cwd,
    transcript_path: `/tmp/${sid}.jsonl`,
    permission_mode: 'default',
  };
  const ev = (hook_event_name: string, extra: HookEvent = {}): Ev => ({
    ...base,
    hook_event_name,
    ...extra,
  });
  const tool = (
    name: string,
    input: ToolInput,
    extra: HookEvent = {},
  ): [number, Ev][] => [
    [
      400,
      ev('PreToolUse', {
        tool_name: name,
        tool_input: input,
        tool_use_id: `${sid}-${name}-${Math.random().toString(36).slice(2, 6)}`,
        ...extra,
      }),
    ],
    [
      1800,
      ev('PostToolUse', {
        tool_name: name,
        tool_input: input,
        tool_response: 'x'.repeat(2000),
        ...extra,
      }),
    ],
  ];
  return [
    [0, ev('SessionStart', { source: 'startup', model })],
    [
      2500,
      ev('UserPromptSubmit', {
        prompt: '사무실 UI에 말풍선 기능을 추가해줘. 그리고 테스트도 돌려봐.',
      }),
    ],
    ...tool('Read', { file_path: `${cwd}/server/index.ts` }),
    ...tool('Grep', { pattern: 'speech|bubble', path: cwd }),
    ...tool('Edit', {
      file_path: `${cwd}/web/office.js`,
      old_string: 'a',
      new_string: 'b',
    }),
    ...tool('Write', { file_path: `${cwd}/web/bubble.js`, content: '...' }),
    ...tool('Bash', {
      command: 'pnpm test',
      description: 'Run the test suite',
    }),
    ...tool('WebSearch', { query: 'canvas measureText CJK wrap' }),
    [
      300,
      ev('PreToolUse', {
        tool_name: 'Agent',
        tool_input: {
          description: 'Review bubble code',
          subagent_type: 'Explore',
          prompt: '...',
        },
        tool_use_id: `${sid}-agent`,
      }),
    ],
    [500, ev('SubagentStart', { agent_id: agentId, agent_type: 'Explore' })],
    [
      300,
      ev('PostToolUse', {
        tool_name: 'Agent',
        tool_input: { description: 'Review bubble code' },
        tool_response: 'started',
      }),
    ],
    [
      600,
      ev('PreToolUse', {
        agent_id: agentId,
        agent_type: 'Explore',
        tool_name: 'Read',
        tool_input: { file_path: `${cwd}/web/bubble.js` },
      }),
    ],
    [
      1500,
      ev('PostToolUse', {
        agent_id: agentId,
        agent_type: 'Explore',
        tool_name: 'Read',
        tool_input: { file_path: `${cwd}/web/bubble.js` },
      }),
    ],
    [
      400,
      ev('PreToolUse', {
        agent_id: agentId,
        agent_type: 'Explore',
        tool_name: 'Grep',
        tool_input: { pattern: 'wrap' },
      }),
    ],
    [
      1500,
      ev('PostToolUse', {
        agent_id: agentId,
        agent_type: 'Explore',
        tool_name: 'Grep',
        tool_input: { pattern: 'wrap' },
      }),
    ],
    [
      800,
      ev('SubagentStop', {
        agent_id: agentId,
        agent_type: 'Explore',
        last_assistant_message:
          'bubble.js looks fine. One nit: wrap per character for CJK.',
      }),
    ],
    [
      800,
      ev('PreToolUse', {
        tool_name: 'Bash',
        tool_input: {
          command: 'rm -rf build && pnpm build',
          description: 'Rebuild from scratch',
        },
        tool_use_id: `${sid}-rm`,
      }),
    ],
    [
      200,
      ev('PermissionRequest', {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf build && pnpm build' },
      }),
    ],
    [
      4000,
      ev('PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf build && pnpm build' },
        tool_response: 'ok',
      }),
    ],
    [
      1500,
      ev('Stop', {
        stop_hook_active: false,
        last_assistant_message: finalText,
      }),
    ],
    [
      3000,
      ev('Notification', {
        notification_type: 'idle_prompt',
        message: 'Claude is waiting for your input',
      }),
    ],
    [9000, ev('SessionEnd', { reason: 'prompt_input_exit' })],
  ];
}

async function play(steps: [number, Ev][]) {
  for (const [delay, ev] of steps) {
    await sleep(delay);
    if (stopping) return;
    await send(ev);
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  const ids = [...active.keys()];
  if (ids.length)
    console.log(`\n${signal}: sending ${ids.length} demo session(s) home`);
  await Promise.all(
    ids.map((id) =>
      send({
        ...active.get(id)!,
        hook_event_name: 'SessionEnd',
        reason: 'demo_stopped',
      }),
    ),
  );
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => shutdown(sig));
  } catch {
    /* not every signal exists on every platform */
  }
}

// A previous demo that was killed hard (closed terminal, taskkill) never sent its
// SessionEnd events; send those leftovers home before starting fresh ones.
async function sweepLeftovers() {
  let snap: Partial<Snapshot>;
  try {
    snap = await (await fetch(`${BASE}/state`)).json();
  } catch {
    return;
  }
  const stale = Object.values(snap.sessions || {}).filter(
    (s) => /^demo-/.test(s.id) && !s.ended,
  );
  if (!stale.length) return;
  console.log(
    `sending ${stale.length} leftover demo session(s) from an earlier run home`,
  );
  await Promise.all(
    stale.map((s) =>
      send({
        session_id: s.id,
        cwd: s.cwd,
        transcript_path: `/tmp/${s.id}.jsonl`,
        permission_mode: 'default',
        hook_event_name: 'SessionEnd',
        reason: 'demo_restarted',
      }),
    ),
  );
}

await sweepLeftovers();
let round = 0;
do {
  const tag = round ? `-${round}` : '';
  await Promise.all([
    play(
      script(
        `demo-alpha${tag}`,
        '/home/demo/pawgents-office',
        `demo-agent-a${tag}`,
        '말풍선 기능을 추가했습니다. `web/bubble.js`에 CJK 글자 단위 줄바꿈을 넣었고, 테스트 12개가 모두 통과합니다.',
      ),
    ),
    (async () => {
      await sleep(5000);
      await play(
        script(
          `demo-beta${tag}`,
          '/home/demo/payments-api',
          `demo-agent-b${tag}`,
          'Done. I refactored the webhook handler and added retry logic; all 48 tests pass.',
          'claude-opus-5-5',
        ),
      );
    })(),
  ]);
  round++;
  if (LOOP) await sleep(4000);
} while (LOOP && !stopping);
