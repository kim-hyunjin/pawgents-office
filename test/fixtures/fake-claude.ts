// Stands in for `claude -p --input-format stream-json --output-format stream-json` in tests: ignores flags it doesn't need.
const i = process.argv.indexOf('--session-id');
const sid = i > 0 ? process.argv[i + 1] : null;
const out = (o: Record<string, unknown>) =>
  process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', model: 'fake', session_id: sid });
let rem = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  const lines = (rem + chunk).split('\n');
  rem = lines.pop()!;
  for (const line of lines) {
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      o?.type === 'control_request' &&
      o.request?.subtype === 'set_permission_mode'
    ) {
      // like claude: bypass needs a launch flag
      const { mode } = o.request;
      if (mode === 'bypassPermissions') {
        out({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: o.request_id,
            error: 'not launched with --dangerously-skip-permissions',
            error_code: 'bypass_not_launched',
          },
        });
        continue;
      }
      out({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: o.request_id,
          response: { mode },
        },
      });
      out({
        type: 'system',
        subtype: 'status',
        status: null,
        permissionMode: mode,
        session_id: sid,
      });
      continue;
    }
    if (o?.type !== 'user') continue;
    out({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'ok' }] },
      session_id: sid,
    });
    out({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.001,
      result: 'ok',
      session_id: sid,
    });
  }
});
process.stdin.on('end', () => process.exit(0));
