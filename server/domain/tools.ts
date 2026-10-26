// What Claude Code's tools mean to a reader: a short target and a longer description of one tool call.
import path from 'node:path';
import { oneLine, truncate } from '../../shared/text.ts';
import type { ToolInput } from '../types.ts';

/** The file a tool call names (Read/Edit/Write/NotebookEdit…, or a search's `path`). */
const toolFilePath = (input: ToolInput) =>
  input.file_path || input.notebook_path || input.path;

/** Short human target for a tool call: file name, command head, pattern... */
export function summarizeToolInput(
  tool: string | undefined,
  input?: ToolInput | null,
) {
  if (!input || typeof input !== 'object') return '';
  const fp = toolFilePath(input);
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return fp ? path.basename(String(fp)) : '';
    case 'Bash':
      return truncate(oneLine(input.description || input.command || ''), 40);
    case 'Grep':
    case 'Glob':
      return truncate(String(input.pattern || ''), 40);
    case 'Agent':
    case 'Task':
      return truncate(
        String(input.description || input.subagent_type || ''),
        40,
      );
    case 'WebFetch':
      try {
        return new URL(String(input.url)).hostname;
      } catch {
        return '';
      }
    case 'WebSearch':
      return truncate(String(input.query || ''), 40);
    case 'Skill':
      return truncate(String(input.skill || ''), 40);
    default: {
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v) return truncate(oneLine(v), 40);
      }
      return '';
    }
  }
}

/** Longer human description of a tool call for tooltips / log details (≤ 300 chars). */
export function detailForTool(
  tool: string | undefined,
  input?: ToolInput | null,
) {
  if (!input || typeof input !== 'object') return '';
  const fp = toolFilePath(input) || '';
  const n = (v: unknown) => (typeof v === 'string' ? v.length : 0);
  let d = '';
  switch (tool) {
    case 'Read':
      d = `${fp}${input.offset ? ` (from line ${input.offset}${input.limit ? `, ${input.limit} lines` : ''})` : ''}`;
      break;
    case 'Edit':
      d = `${fp}  (${n(input.old_string)}자 → ${n(input.new_string)}자${input.replace_all ? ', 전체 치환' : ''})`;
      break;
    case 'MultiEdit':
      d = `${fp}  (${Array.isArray(input.edits) ? input.edits.length : '?'}곳)`;
      break;
    case 'Write':
      d = `${fp}  (${n(input.content)}자)`;
      break;
    case 'NotebookEdit':
      d = `${fp}  cell ${input.cell_id ?? ''}`;
      break;
    case 'Bash':
      d = oneLine(input.command || '');
      if (input.description) d = `${input.description} — ${d}`;
      break;
    case 'Grep':
      d = `/${input.pattern}/${input.path ? ' in ' + input.path : ''}${input.glob ? ' (' + input.glob + ')' : ''}`;
      break;
    case 'Glob':
      d = `${input.pattern}${input.path ? ' in ' + input.path : ''}`;
      break;
    case 'Agent':
    case 'Task':
      d = `${input.subagent_type ? '[' + input.subagent_type + '] ' : ''}${input.description || ''}${input.prompt ? ' — ' + oneLine(input.prompt) : ''}`;
      break;
    case 'WebFetch':
      d = `${input.url || ''}${input.prompt ? ' — ' + oneLine(input.prompt) : ''}`;
      break;
    case 'WebSearch':
      d = String(input.query || '');
      break;
    case 'Skill':
      d = `${input.skill || ''} ${input.args || ''}`;
      break;
    case 'AskUserQuestion':
      d = Array.isArray(input.questions)
        ? input.questions
            .map((q: any) => q?.question)
            .filter(Boolean)
            .join(' / ')
        : '';
      break;
    case 'TodoWrite':
      d = Array.isArray(input.todos)
        ? input.todos
            .map(
              (t: any) =>
                `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'} ${t.content}`,
            )
            .join('  ')
        : '';
      break;
    default:
      d = Object.entries(input)
        .filter(([, v]) => typeof v === 'string' && v)
        .map(([k, v]) => `${k}: ${oneLine(v)}`)
        .join('  ');
  }
  return truncate(oneLine(d), 300);
}
