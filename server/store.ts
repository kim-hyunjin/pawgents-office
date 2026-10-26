import fs from 'node:fs';
import path from 'node:path';
import { safeJsonParse } from '../shared/json.ts';
import type { Layout } from '../shared/layout.ts';
import {
  cloneOffice,
  DEFAULT_OFFICE,
  deskCount,
  normalize,
  validate,
} from '../shared/layout.ts';
import { isCatFamily } from '../shared/model.ts';
import {
  DESK_MEMORY_MS,
  LOG_SIZE,
  MAX_FILES,
  ORPHAN_SESSION_MS,
  SEATS_PER_DESK,
  SESSION_TTL_MS,
  SKINS_DIR,
  SNAPSHOT_FILES,
  SNAPSHOT_LOG,
  STATE_FILE,
  SUBAGENT_STALE_MS,
  SUBAGENT_TTL_MS,
} from './config.ts';
import { repoOf } from './repo.ts';
import { hasSkin, newSkinId, SKIN_ID } from './skins.ts';
import type {
  Backend,
  DeskMemory,
  Entity,
  EntityState,
  FileEntry,
  Log,
  LogEntry,
  Office,
  Session,
  SessionSnapshot,
  Skin,
  Snapshot,
  Subagent,
  SubagentSnapshot,
} from './types.ts';
import { debounce } from './util.ts';

/** What a registry file / hook knows when a session is first seen. */
export interface SessionInit {
  pid?: number | null;
  name?: string;
  cwd?: string;
  model?: string | null;
  startedAt?: number;
  transcriptPath?: string | null;
  permissionMode?: string | null;
  backend?: Backend | null;
}
export interface SubagentInit {
  type?: string | null;
  model?: string | null;
  description?: string | null;
  task?: string | null;
  toolUseId?: string | null;
  transcriptPath?: string | null;
}
type Listener = (type: string, data: unknown) => void;

class RingBuffer implements Log {
  n: number;
  buf: LogEntry[];
  constructor(n: number) {
    this.n = n;
    this.buf = [];
  }
  push(x: LogEntry) {
    this.buf.push(x);
    if (this.buf.length > this.n) this.buf.shift();
  }
  toArray() {
    return this.buf.slice();
  }
  last(k: number) {
    return this.buf.slice(-k);
  }
}

// a built-in breed (the list itself lives in web/sprites.js) or an uploaded skin, 'skin:<id>'
export const BREED_KEY = /^([a-z]{2,24}|skin:[a-z0-9]{10})$/;
export const DEFAULT_OFFICE_ID = 'default';
const newOffice = (
  id: string,
  name: string,
  repos: string[],
  layout: Layout = cloneOffice(DEFAULT_OFFICE),
): Office => ({ id, name, repos, layout });
const defaultOffice = () => newOffice(DEFAULT_OFFICE_ID, '사무실', ['default']);

/** Clock out a session or subagent (callers check `ended` first). */
function markEnded(ent: Entity) {
  ent.ended = true;
  ent.endedAt = Date.now();
  ent.state = 'offduty';
  ent.stateSince = ent.endedAt;
  ent.currentTool = null;
}

export class Store {
  sessions: Map<string, Session>;
  desks: Record<string, DeskMemory>;
  offices: Office[];
  cats: Record<string, string>;
  skins: Skin[];
  together: string | null;
  stateFile: string;
  skinsDir: string;
  listeners: Set<Listener>;
  save: () => void;

  constructor({
    stateFile = STATE_FILE,
    skinsDir = SKINS_DIR,
  }: { stateFile?: string; skinsDir?: string } = {}) {
    this.sessions = new Map();
    this.desks = {}; // sessionId -> { desk, office, at, terminal? }
    this.offices = [defaultOffice()]; // one per repo; repos: repo keys that work there
    this.cats = {}; // model family -> breed key the user picked (absent = default breed)
    this.skins = []; // uploaded sprite sheets: { id, name, cellW, cellH }, image at skinsDir/<id>.png
    this.together = null; // office id everyone works in regardless of repo, or null: each repo in its own office
    this.stateFile = stateFile;
    this.skinsDir = skinsDir;
    this.listeners = new Set();
    this.save = debounce(() => this.saveNow(), 500);
  }

  // ---- persistence -------------------------------------------------------
  load() {
    const data = safeJsonParse(
      fs.existsSync(this.stateFile)
        ? fs.readFileSync(this.stateFile, 'utf8')
        : '',
    );
    this.loadDesks(data?.desks);
    this.loadSkins(data?.skins);
    this.loadCats(data?.cats); // after skins: a pick of a skin that is gone is dropped
    this.loadOffices(data?.offices, data?.together);
  }
  loadDesks(desks: any) {
    const now = Date.now();
    this.desks = {};
    for (const [id, v] of Object.entries(
      (desks || {}) as Record<string, any>,
    )) {
      if (v && typeof v.desk === 'number' && now - (v.at || 0) < DESK_MEMORY_MS)
        this.desks[id] = v;
    }
  }
  loadSkins(skins: any) {
    this.skins = [];
    for (const k of Array.isArray(skins) ? skins : []) {
      if (
        SKIN_ID.test(k?.id) &&
        !hasSkin(this.skins, k.id) &&
        fs.existsSync(this.skinFile(k.id))
      ) {
        this.skins.push({
          id: k.id,
          name: String(k.name || '스킨'),
          cellW: k.cellW,
          cellH: k.cellH,
        });
      }
    }
  }
  loadCats(cats: any) {
    this.cats = {};
    for (const [fam, breed] of Object.entries(
      (cats || {}) as Record<string, any>,
    )) {
      if (isCatFamily(fam) && BREED_KEY.test(breed) && this.hasBreed(breed))
        this.cats[fam] = breed;
    }
  }
  loadOffices(list: any, together: any) {
    const offices: Office[] = [];
    for (const o of Array.isArray(list) ? list : []) {
      if (
        typeof o?.id !== 'string' ||
        offices.some((x) => x.id === o.id) ||
        !Array.isArray(o.repos)
      )
        continue;
      const saved = normalize(o.layout);
      const layout = validate(saved).length
        ? cloneOffice(DEFAULT_OFFICE)
        : saved!; // a broken layout falls back to the default
      offices.push(
        newOffice(
          o.id,
          String(o.name || '사무실'),
          o.repos.filter((r: unknown): r is string => typeof r === 'string'),
          layout,
        ),
      );
    }
    if (!offices.some((o) => o.id === DEFAULT_OFFICE_ID))
      offices.unshift(defaultOffice());
    this.offices = offices;
    this.together = offices.some((o) => o.id === together) ? together : null;
  }
  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(
        this.stateFile,
        JSON.stringify(
          {
            desks: this.desks,
            cats: this.cats,
            skins: this.skins,
            offices: this.offices,
            together: this.together,
            updatedAt: Date.now(),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.error('[store] save failed:', (e as Error).message);
    }
  }

  // ---- events --------------------------------------------------------------
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners) fn(type, data);
  }
  emitSession(s: Session) {
    this.emit('session', this.serializeSession(s));
  }

  // ---- settings ------------------------------------------------------------
  /** Pick the breed a model family is drawn as; null restores the default. Pushed to every browser. */
  setCat(fam: string, breed: string | null) {
    if (breed) this.cats[fam] = breed;
    else delete this.cats[fam];
    this.commitSettings();
  }
  emitSettings() {
    this.emit('settings', { cats: this.cats, skins: this.skins });
  }
  /** Persist and push the cat / skin settings after a change. */
  commitSettings() {
    this.save();
    this.emitSettings();
  }
  skinFile(id: string) {
    return path.join(this.skinsDir, `${id}.png`);
  }
  /** Skins must exist; built-in breed keys are checked by the browser (unknown ones draw the default). */
  hasBreed(breed: string) {
    return !breed.startsWith('skin:') || hasSkin(this.skins, breed.slice(5));
  }
  /** Store an uploaded sprite sheet (already validated) and offer it to every browser. */
  addSkin({ name, cellW, cellH }: Omit<Skin, 'id'>, png: Buffer) {
    const id = newSkinId(this.skins);
    fs.mkdirSync(this.skinsDir, { recursive: true });
    fs.writeFileSync(this.skinFile(id), png);
    const skin: Skin = { id, name, cellW, cellH };
    this.skins.push(skin);
    this.commitSettings();
    return skin;
  }
  /** Delete a skin; families drawn with it go back to their default breed. */
  removeSkin(id: string) {
    if (!hasSkin(this.skins, id)) return false;
    this.skins = this.skins.filter((k) => k.id !== id);
    for (const [fam, breed] of Object.entries(this.cats))
      if (breed === `skin:${id}`) delete this.cats[fam];
    try {
      fs.unlinkSync(this.skinFile(id));
    } catch {
      /* already gone */
    }
    this.commitSettings();
    return true;
  }

  // ---- offices --------------------------------------------------------------
  office(id: string | null) {
    return this.offices.find((o) => o.id === id);
  }
  emitOffices() {
    this.emit('offices', { offices: this.offices, together: this.together });
  }
  /** Persist and push the office list after a change. */
  commitOffices() {
    this.save();
    this.emitOffices();
  }
  /** The office a working directory belongs to: its repo's, created (with the default layout) the first time. */
  officeFor(cwd?: string) {
    const repo = repoOf(cwd);
    let o = this.offices.find((x) => x.repos.includes(repo.key));
    if (!o) {
      o = newOffice(
        `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        repo.name || '사무실',
        [repo.key],
      );
      this.offices.push(o);
      this.commitOffices();
    }
    return o.id;
  }
  /** Send a session to its repo's office, or the shared one (cwd can arrive after the session); a move gets it a desk there. */
  placeSession(s: Session) {
    const own = this.officeFor(s.cwd); // created even while together, so splitting up later has somewhere to go
    const id = this.together ?? own;
    if (s.officeId === id) return false;
    s.officeId = id;
    if (!s.ended) s.desk = this.assignDesk(s.id, id);
    return true;
  }
  setCwd(s: Session, cwd?: string) {
    if (!cwd || s.cwd === cwd) return false;
    s.cwd = cwd;
    this.placeSession(s);
    return true;
  }
  /** Gather everyone in one office (null: back to their repos' offices), moving the staff right away. */
  setTogether(officeId: string | null) {
    this.together = officeId;
    for (const s of this.sessions.values())
      if (this.placeSession(s)) this.emitSession(s);
    this.commitOffices();
  }
  /** Sessions in an office whose desk is gone (layout shrank) get a free one, if any. */
  reseat(officeId: string) {
    const n = deskCount(this.office(officeId)!.layout);
    for (const s of this.sessions.values()) {
      if (s.ended || s.officeId !== officeId || s.desk === null || s.desk < n)
        continue;
      s.desk = this.assignDesk(s.id, officeId);
      this.emitSession(s);
    }
  }
  setLayout(officeId: string, layout: Layout) {
    const o = this.office(officeId)!;
    o.layout = layout;
    this.reseat(officeId);
    this.commitOffices();
  }
  renameOffice(officeId: string, name: string) {
    this.office(officeId)!.name = name;
    this.commitOffices();
  }
  /** Close an office: its repos and staff move to the default office. */
  deleteOffice(officeId: string) {
    const o = this.office(officeId)!,
      home = this.office(DEFAULT_OFFICE_ID)!;
    home.repos.push(...o.repos.filter((r) => !home.repos.includes(r)));
    this.offices = this.offices.filter((x) => x !== o);
    if (this.together === officeId) this.together = DEFAULT_OFFICE_ID;
    for (const s of this.sessions.values()) {
      if (s.officeId !== officeId) continue;
      s.officeId = DEFAULT_OFFICE_ID;
      if (!s.ended) s.desk = this.assignDesk(s.id, DEFAULT_OFFICE_ID);
      this.emitSession(s);
    }
    this.commitOffices();
  }

  // ---- desks ---------------------------------------------------------------
  assignDesk(sessionId: string, officeId: string | null) {
    const used = new Set<number | null>();
    for (const s of this.sessions.values())
      if (!s.ended && s.id !== sessionId && s.officeId === officeId)
        used.add(s.desk);
    const n = deskCount(this.office(officeId)!.layout);
    const remembered = this.desks[sessionId];
    let desk: number;
    if (
      remembered &&
      (remembered.office ?? DEFAULT_OFFICE_ID) === officeId &&
      remembered.desk < n &&
      !used.has(remembered.desk)
    )
      desk = remembered.desk; // layouts can shrink
    else {
      desk = 0;
      while (used.has(desk)) desk++;
    } // past the last desk: standing in the lobby
    this.desks[sessionId] = {
      ...remembered,
      desk,
      office: officeId ?? undefined,
      at: Date.now(),
    };
    this.save();
    return desk;
  }
  /** Link a session to its Orca terminal; remembered with the desk so a server restart keeps it. */
  setTerminal(s: Session, handle?: string | null) {
    if (!handle || s.orcaTerminal === handle) return;
    s.orcaTerminal = handle;
    const d = this.desks[s.id];
    if (d) {
      d.terminal = handle;
      this.save();
    }
  }
  /** Who drives the session (kept across revive: a runner outlives a server restart). */
  setBackend(s: Session, backend: Backend | null) {
    if (s.backend === backend) return false;
    s.backend = backend;
    return true;
  }
  releaseDesk(sessionId: string) {
    delete this.desks[sessionId];
    this.save();
  }
  assignSeat(session: Session) {
    const used = new Set<number>();
    for (const a of session.subagents.values()) if (!a.ended) used.add(a.seat);
    let seat = 0;
    while (used.has(seat)) seat++;
    return seat; // >= SEATS_PER_DESK overflows to the bullpen on the client
  }

  // ---- sessions ------------------------------------------------------------
  getOrCreateSession(id: string, init: SessionInit = {}): Session {
    let s = this.sessions.get(id);
    if (s) {
      if (s.ended) this.revive(s);
      if (init.cwd && !s.cwd) {
        this.setCwd(s, init.cwd);
        if (!s.nameSource) s.name = path.basename(init.cwd) || s.name;
      }
      if (init.transcriptPath && !s.transcriptPath)
        s.transcriptPath = init.transcriptPath;
      if (init.permissionMode && !s.permissionMode)
        s.permissionMode = init.permissionMode;
      return s;
    }
    const now = Date.now();
    s = {
      id,
      pid: init.pid ?? null,
      name: init.name || (init.cwd ? path.basename(init.cwd) : id.slice(0, 8)),
      nameSource: init.name ? 'registry' : null,
      title: null,
      cwd: init.cwd || '',
      model: init.model || null,
      state: 'idle',
      stateSince: now,
      currentTool: null,
      lastText: null,
      lastTextAt: 0,
      replyText: null, // full markdown of lastText, for the reply dialog
      lastPrompt: null,
      lastThinking: null,
      lastThinkingAt: 0,
      turnStartedAt: 0,
      turnTools: 0,
      cost: null, // { usd, linesAdded, linesRemoved, apiMs } from transcript
      pendingAgents: [], // Agent tool calls waiting for their SubagentStart
      bgTasks: [], // background work the idle session waits on, as of its last Stop
      awaitingShell: false, // registry status 'shell' (covers sessions without our hooks)
      startedAt: init.startedAt || now,
      lastEventAt: now,
      hookEvents: 0,
      ended: false,
      endedAt: null,
      officeId: null,
      desk: null,
      permissionMode: init.permissionMode ?? null,
      backend: init.backend ?? null, // 'headless' when a runner owns it; null: Orca or a terminal we don't control
      pendingPermissions: [], // headless permission requests parked for the browser (Step 5): [{ id, tool, target, detail, at }]
      asking: null, // interactive sessions: the dialog their terminal shows (answered there): { tool, target, detail, label, at }
      transcriptPath: init.transcriptPath || null,
      orcaTerminal: this.desks[id]?.terminal || null, // Orca terminal handle (hook env or resolved) for sending prompts
      log: new RingBuffer(LOG_SIZE),
      files: new Map(), // normalized path -> { path, name, edited, touched, git, t }: files its tools touched (touched) and/or git status lists (git)
      subagents: new Map(),
    };
    this.sessions.set(id, s);
    this.placeSession(s);
    return s;
  }
  revive(s: Session) {
    s.ended = false;
    s.endedAt = null;
    s.state = 'idle';
    s.stateSince = Date.now();
    s.desk = this.assignDesk(s.id, s.officeId);
  }
  endSession(s: Session, reason = 'ended') {
    if (s.ended) return;
    markEnded(s);
    s.pendingPermissions = []; // nobody can answer them now (the backend settles the parked hooks)
    s.asking = null;
    for (const a of s.subagents.values()) this.endSubagent(a);
    this.log(s, { ev: 'SessionEnd', text: reason });
  }

  getOrCreateSubagent(
    s: Session,
    agentId: string,
    init: SubagentInit = {},
  ): Subagent {
    let a = s.subagents.get(agentId);
    if (a) {
      if (init.type && !a.type) a.type = init.type;
      return a;
    }
    const now = Date.now();
    a = {
      agentId,
      parentSessionId: s.id,
      type: init.type || null,
      model: init.model || null,
      description: init.description || null,
      task: init.task || null, // prompt the parent gave this agent (head)
      toolUseId: init.toolUseId || null,
      lastThinking: null,
      lastThinkingAt: 0,
      toolCount: 0,
      state: 'thinking',
      stateSince: now,
      currentTool: null,
      lastText: null,
      lastTextAt: 0,
      replyText: null, // full markdown of lastText, for the reply dialog
      startedAt: now,
      lastEventAt: now,
      ended: false,
      endedAt: null,
      seat: this.assignSeat(s),
      transcriptPath: init.transcriptPath || null,
    };
    s.subagents.set(agentId, a);
    return a;
  }
  endSubagent(a: Subagent) {
    if (a.ended) return;
    markEnded(a);
  }

  setState(ent: Entity, state: EntityState) {
    if (ent.state === state) return;
    ent.state = state;
    ent.stateSince = Date.now();
  }

  log(s: Session, entry: Omit<LogEntry, 't'>) {
    s.log.push({ t: Date.now(), ...entry });
  }

  /** Note a file a tool call touched (relative paths resolve against the session's cwd). The newest MAX_FILES are kept. */
  touchFile(
    s: Session,
    fp: string,
    { edited = false }: { edited?: boolean } = {},
  ) {
    const f = this.fileEntry(s, fp);
    f.edited ||= edited;
    f.touched = true;
    this.bumpFile(s, f, Date.now());
    return f;
  }
  fileEntry(s: Session, fp: string): FileEntry {
    const key = path.normalize(
      path.isAbsolute(fp) ? fp : path.resolve(s.cwd || '', fp),
    );
    return (
      s.files.get(key) || {
        path: key,
        name: path.basename(key),
        edited: false,
        touched: false,
        git: null,
        t: 0,
      }
    );
  }
  /** Move a file to the newest end (Map order is touch order) with time `t`, dropping the oldest past MAX_FILES. */
  bumpFile(s: Session, f: FileEntry, t: number) {
    f.t = Math.max(f.t, t);
    s.files.delete(f.path);
    s.files.set(f.path, f);
    if (s.files.size > MAX_FILES) s.files.delete(s.files.keys().next().value!);
  }
  /**
   * Fold `git status` of the session's worktree into its files: [{ path, status }] with one letter each
   * (M, A, D, ?, …). Files git no longer lists lose their mark, or go entirely if no tool of this session touched
   * them. A file git alone knows is ordered by its mtime. Returns true if anything changed.
   */
  setGitFiles(s: Session, list: { path: string; status: string }[]) {
    let changed = false;
    const seen = new Set<string>();
    for (const { path: fp, status } of list) {
      const f = this.fileEntry(s, fp);
      seen.add(f.path);
      if (f.git === status && s.files.has(f.path)) continue;
      changed = true;
      f.git = status;
      f.edited = true;
      let t = f.t;
      if (!t) {
        try {
          t = fs.statSync(f.path).mtimeMs;
        } catch {
          t = Date.now();
        }
      } // deleted: now
      this.bumpFile(s, f, t);
    }
    for (const f of [...s.files.values()]) {
      if (!f.git || seen.has(f.path)) continue;
      changed = true;
      if (f.touched) f.git = null;
      else s.files.delete(f.path);
    }
    return changed;
  }

  // ---- gc ------------------------------------------------------------------
  gc() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      let changed = false;
      for (const a of s.subagents.values()) {
        if (!a.ended && now - a.lastEventAt > SUBAGENT_STALE_MS) {
          this.endSubagent(a);
          changed = true;
        }
        if (a.ended && now - a.endedAt! > SUBAGENT_TTL_MS) {
          s.subagents.delete(a.agentId);
          changed = true;
        }
      }
      if (!s.ended && !s.pid && now - s.lastEventAt > ORPHAN_SESSION_MS) {
        this.endSession(s, 'no events for 30 min');
        changed = true;
      }
      if (s.ended && now - s.endedAt! > SESSION_TTL_MS) {
        this.sessions.delete(s.id);
        this.releaseDesk(s.id);
        this.emit('remove', { id: s.id });
        continue;
      }
      if (changed) this.emitSession(s);
    }
  }

  // ---- serialization -------------------------------------------------------
  serializeSubagent(a: Subagent): SubagentSnapshot {
    return {
      agentId: a.agentId,
      parentSessionId: a.parentSessionId,
      type: a.type,
      model: a.model,
      description: a.description,
      task: a.task,
      lastThinking: a.lastThinking,
      lastThinkingAt: a.lastThinkingAt,
      toolCount: a.toolCount,
      state: a.state,
      stateSince: a.stateSince,
      currentTool: a.currentTool,
      lastText: a.lastText,
      lastTextAt: a.lastTextAt,
      startedAt: a.startedAt,
      lastEventAt: a.lastEventAt,
      ended: a.ended,
      endedAt: a.endedAt,
      seat: a.seat,
    };
  }
  serializeSession(s: Session, logCount = SNAPSHOT_LOG): SessionSnapshot {
    return {
      id: s.id,
      pid: s.pid,
      name: s.name,
      title: s.title,
      cwd: s.cwd,
      model: s.model,
      state: s.state,
      stateSince: s.stateSince,
      currentTool: s.currentTool,
      lastText: s.lastText,
      lastTextAt: s.lastTextAt,
      lastPrompt: s.lastPrompt,
      lastThinking: s.lastThinking,
      lastThinkingAt: s.lastThinkingAt,
      turnStartedAt: s.turnStartedAt,
      turnTools: s.turnTools,
      cost: s.cost,
      startedAt: s.startedAt,
      lastEventAt: s.lastEventAt,
      ended: s.ended,
      endedAt: s.endedAt,
      officeId: s.officeId,
      desk: s.desk,
      permissionMode: s.permissionMode,
      hookEvents: s.hookEvents,
      orcaTerminal: s.orcaTerminal,
      backend: s.backend,
      pendingPermissions: s.pendingPermissions,
      asking: s.asking,
      bgTasks: s.bgTasks,
      awaitingShell: s.awaitingShell,
      subagents: [...s.subagents.values()].map((a) =>
        this.serializeSubagent(a),
      ),
      files: [...s.files.values()]
        .reverse()
        .slice(0, SNAPSHOT_FILES)
        .map(({ path: p, name, edited, git, t }) => ({
          path: p,
          name,
          edited,
          git,
          t,
        })), // newest first (see bumpFile)
      log: s.log.last(logCount),
    };
  }
  snapshot(): Snapshot {
    return {
      now: Date.now(),
      offices: this.offices,
      together: this.together,
      seatsPerDesk: SEATS_PER_DESK,
      cats: this.cats,
      skins: this.skins,
      sessions: [...this.sessions.values()].map((s) =>
        this.serializeSession(s),
      ),
    };
  }
}
