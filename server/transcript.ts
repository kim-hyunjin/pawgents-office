import path from 'node:path';
import { field, isRecord, safeJsonParse } from '../shared/json.ts';
import { cleanText, oneLine } from '../shared/text.ts';
import { TRANSCRIPT_TAIL_BYTES } from './config.ts';
import { replyText } from './domain/text.ts';
import { readFrom, readSafe, readTail } from './infra/fs.ts';
import type { Store } from './store.ts';
import type { Entity, Session, Subagent } from './types.ts';

/**
 * Tails session / subagent transcripts (append-only JSONL) to fill in
 * title, model, last assistant text and subagent descriptions.
 * Never changes an entity's state — hooks own that.
 */
/** A count from a transcript line: the number, or 0 when it is missing (or not a number). */
const count = (v: unknown) => (typeof v === 'number' && v) || 0;

export class Tailer {
  store: Store;
  files: Map<string, { offset: number; rem: string }>;

  constructor(store: Store) {
    this.store = store;
    this.files = new Map(); // file -> { offset, rem }
  }

  tick() {
    for (const s of this.store.sessions.values()) {
      if (s.ended) continue;
      this.store.updateSession(s, () => this.pumpSession(s));
    }
  }

  /** Read what was appended to `s`'s transcripts (its own and its live subagents'). Returns true if `s` changed. */
  pumpSession(s: Session) {
    let changed = false;
    if (s.transcriptPath)
      changed = this.pump(s.transcriptPath, s, s, true) || changed;
    for (const a of s.subagents.values()) {
      if (a.ended) continue;
      const file = a.transcriptPath || this.guessAgentPath(s, a);
      if (!file) continue;
      if (!a.metaRead) changed = this.readMeta(file, a) || changed;
      changed = this.pump(file, s, a, false) || changed;
    }
    return changed;
  }

  guessAgentPath(s: Session, a: Subagent) {
    if (!s.transcriptPath) return null;
    const dir = path.join(path.dirname(s.transcriptPath), s.id, 'subagents');
    return path.join(dir, `agent-${a.agentId}.jsonl`);
  }

  readMeta(file: string, a: Subagent) {
    const parsed = safeJsonParse(
      readSafe(file.replace(/\.jsonl$/, '.meta.json')),
    );
    if (!parsed) return false;
    a.metaRead = true;
    const meta = isRecord(parsed) ? parsed : {};
    let changed = false;
    if (meta.description && !a.description) {
      a.description = oneLine(meta.description);
      changed = true;
    }
    if (typeof meta.agentType === 'string' && meta.agentType && !a.type) {
      a.type = meta.agentType;
      changed = true;
    }
    if (typeof meta.model === 'string' && meta.model && !a.model) {
      a.model = meta.model;
      changed = true;
    }
    return changed;
  }

  /** Read new bytes of `file` and apply them to `ent` (session or subagent). Returns true if something changed. */
  pump(file: string, session: Session, ent: Entity, isMain: boolean) {
    let f = this.files.get(file);
    let text: string;
    if (!f) {
      const tail = readTail(file, TRANSCRIPT_TAIL_BYTES);
      if (!tail) return false;
      f = { offset: tail.size, rem: '' };
      this.files.set(file, f);
      text = tail.text;
      if (tail.start > 0) text = text.slice(text.indexOf('\n') + 1); // drop partial first line
    } else {
      const r = readFrom(file, f.offset);
      if (!r) return false;
      if (r.size < f.offset) {
        f.offset = 0;
        f.rem = '';
        return false;
      } // truncated/rotated
      if (!r.text) return false;
      f.offset = r.size;
      text = f.rem + r.text;
    }
    const lines = text.split('\n');
    f.rem = lines.pop() ?? '';
    let changed = false;
    for (const line of lines)
      changed = this.applyLine(line, session, ent, isMain) || changed;
    return changed;
  }

  applyLine(line: string, s: Session, ent: Entity, isMain: boolean) {
    if (!line) return false;
    if (isMain) {
      const meta = this.applyMainMeta(line, s);
      if (meta !== null) return meta;
    }
    return this.applyAssistant(line, ent, isMain);
  }

  /** Session-wide lines of the main transcript (title, name, cost). null: not one of them. */
  applyMainMeta(line: string, s: Session): boolean | null {
    if (line.includes('"type":"ai-title"')) {
      const aiTitle = field(safeJsonParse(line), 'aiTitle');
      if (aiTitle && s.title !== aiTitle) {
        s.title = oneLine(aiTitle);
        return true;
      }
      return false;
    }
    if (line.includes('"type":"agent-name"')) {
      const agentName = field(safeJsonParse(line), 'agentName');
      if (agentName && s.name !== agentName) {
        s.name = oneLine(agentName);
        s.nameSource = 'transcript';
        return true;
      }
      return false;
    }
    if (line.includes('"type":"cost-state"')) {
      const o = safeJsonParse(line);
      if (!isRecord(o)) return false;
      s.cost = {
        usd: Number(o.totalCostUSD) || 0,
        linesAdded: count(o.totalLinesAdded),
        linesRemoved: count(o.totalLinesRemoved),
        apiMs: count(o.totalAPIDuration),
      };
      return true;
    }
    return null;
  }

  /** An assistant message: its model, latest thinking and latest text. */
  applyAssistant(line: string, ent: Entity, isMain: boolean) {
    if (!line.includes('"type":"assistant"')) return false;
    const o = safeJsonParse(line);
    if (!isRecord(o) || o.type !== 'assistant') return false;
    if (isMain && o.isSidechain) return false;
    const m = isRecord(o.message) ? o.message : null;
    let changed = false;
    if (typeof m?.model === 'string' && m.model && ent.model !== m.model) {
      ent.model = m.model;
      changed = true;
    }
    const blocks: unknown[] = Array.isArray(m?.content) ? m.content : [];
    const stamp = String(o.timestamp);
    for (const b of blocks) {
      if (!isRecord(b)) continue;
      if (
        b.type === 'thinking' &&
        typeof b.thinking === 'string' &&
        b.thinking.trim()
      ) {
        const at = Date.parse(stamp) || Date.now();
        if (at >= ent.lastThinkingAt) {
          ent.lastThinking = cleanText(b.thinking, 300);
          ent.lastThinkingAt = at;
          changed = true;
        }
        continue;
      }
      if (b.type !== 'text' || typeof b.text !== 'string' || !b.text.trim())
        continue;
      const text = cleanText(b.text, 280);
      if (!text) continue;
      const at = Date.parse(stamp) || Date.now();
      if (at >= ent.lastTextAt) {
        ent.lastText = text;
        ent.lastTextAt = at;
        ent.replyText = replyText(b.text);
        changed = true;
      }
    }
    return changed;
  }
}
