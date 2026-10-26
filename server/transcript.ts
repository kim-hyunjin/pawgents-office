import path from 'node:path';
import { safeJsonParse } from '../shared/json.ts';
import { cleanText, oneLine } from '../shared/text.ts';
import { TRANSCRIPT_TAIL_BYTES } from './config.ts';
import { replyText } from './domain/text.ts';
import type { Store } from './store.ts';
import type { Entity, Session, Subagent } from './types.ts';
import { readFrom, readSafe, readTail } from './util.ts';

/**
 * Tails session / subagent transcripts (append-only JSONL) to fill in
 * title, model, last assistant text and subagent descriptions.
 * Never changes an entity's state — hooks own that.
 */
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
    const meta = safeJsonParse(
      readSafe(file.replace(/\.jsonl$/, '.meta.json')),
    );
    if (!meta) return false;
    a.metaRead = true;
    let changed = false;
    if (meta.description && !a.description) {
      a.description = oneLine(meta.description);
      changed = true;
    }
    if (meta.agentType && !a.type) {
      a.type = meta.agentType;
      changed = true;
    }
    if (meta.model && !a.model) {
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
      const o = safeJsonParse(line);
      if (o?.aiTitle && s.title !== o.aiTitle) {
        s.title = oneLine(o.aiTitle);
        return true;
      }
      return false;
    }
    if (line.includes('"type":"agent-name"')) {
      const o = safeJsonParse(line);
      if (o?.agentName && s.name !== o.agentName) {
        s.name = oneLine(o.agentName);
        s.nameSource = 'transcript';
        return true;
      }
      return false;
    }
    if (line.includes('"type":"cost-state"')) {
      const o = safeJsonParse(line);
      if (!o) return false;
      s.cost = {
        usd: Number(o.totalCostUSD) || 0,
        linesAdded: o.totalLinesAdded || 0,
        linesRemoved: o.totalLinesRemoved || 0,
        apiMs: o.totalAPIDuration || 0,
      };
      return true;
    }
    return null;
  }

  /** An assistant message: its model, latest thinking and latest text. */
  applyAssistant(line: string, ent: Entity, isMain: boolean) {
    if (!line.includes('"type":"assistant"')) return false;
    const o = safeJsonParse(line);
    if (!o || o.type !== 'assistant') return false;
    if (isMain && o.isSidechain) return false;
    const m = o.message;
    let changed = false;
    if (m?.model && ent.model !== m.model) {
      ent.model = m.model;
      changed = true;
    }
    const blocks = Array.isArray(m?.content) ? m.content : [];
    for (const b of blocks) {
      if (
        b?.type === 'thinking' &&
        typeof b.thinking === 'string' &&
        b.thinking.trim()
      ) {
        const at = Date.parse(o.timestamp) || Date.now();
        if (at >= ent.lastThinkingAt) {
          ent.lastThinking = cleanText(b.thinking, 300);
          ent.lastThinkingAt = at;
          changed = true;
        }
        continue;
      }
      if (b?.type !== 'text' || !b.text || !b.text.trim()) continue;
      const text = cleanText(b.text, 280);
      if (!text) continue;
      const at = Date.parse(o.timestamp) || Date.now();
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
