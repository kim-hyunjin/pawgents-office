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
  ORPHAN_SESSION_MS,
  SESSION_TTL_MS,
  SKINS_DIR,
  STATE_FILE,
  SUBAGENT_STALE_MS,
  SUBAGENT_TTL_MS,
} from './config.ts';
import {
  DEFAULT_OFFICE_ID,
  DEFAULT_OFFICE_NAME,
  defaultOffice,
  newOffice,
  newOfficeId,
  officeOfRepo,
  pickDesk,
} from './domain/office.ts';
import {
  freeSeat,
  markEnded,
  markRevived,
  newSession,
  newSubagent,
  type SessionInit,
  type SubagentInit,
  setState,
} from './domain/session.ts';
import * as files from './domain/worked-files.ts';
import * as dto from './http/dto.ts';
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

export type { SessionInit, SubagentInit };
export { DEFAULT_OFFICE_ID };

type Listener = (type: string, data: unknown) => void;

// a built-in breed (the list itself lives in web/sprites.js) or an uploaded skin, 'skin:<id>'
export const BREED_KEY = /^([a-z]{2,24}|skin:[a-z0-9]{10})$/;

/** A file's mtime, or null when it is gone. */
function mtimeOf(file: string) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
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
          String(o.name || DEFAULT_OFFICE_NAME),
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
    let o = officeOfRepo(this.offices, repo);
    if (!o) {
      o = newOffice(newOfficeId(), repo.name || DEFAULT_OFFICE_NAME, [
        repo.key,
      ]);
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
    const remembered = this.desks[sessionId];
    const desk = pickDesk(
      used,
      deskCount(this.office(officeId)!.layout),
      officeId,
      remembered,
    );
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
    s = newSession(id, init, this.desks[id]?.terminal || null);
    this.sessions.set(id, s);
    this.placeSession(s);
    return s;
  }
  revive(s: Session) {
    markRevived(s);
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
    a = newSubagent(s, agentId, init, freeSeat(s));
    s.subagents.set(agentId, a);
    return a;
  }
  endSubagent(a: Subagent) {
    if (a.ended) return;
    markEnded(a);
  }

  setState(ent: Entity, state: EntityState) {
    setState(ent, state);
  }

  log(s: Session, entry: Omit<LogEntry, 't'>) {
    s.log.push({ t: Date.now(), ...entry });
  }

  /** Note a file a tool call touched (see domain/worked-files.ts). */
  touchFile(s: Session, fp: string, o: { edited?: boolean } = {}) {
    return files.touchFile(s, fp, o);
  }
  /** Fold `git status` into the session's files (see domain/worked-files.ts). Returns true if anything changed. */
  setGitFiles(s: Session, list: { path: string; status: string }[]) {
    return files.setGitFiles(s, list, mtimeOf);
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

  // ---- serialization (http/dto.ts) ---------------------------------------
  serializeSubagent(a: Subagent): SubagentSnapshot {
    return dto.serializeSubagent(a);
  }
  serializeSession(s: Session, logCount?: number): SessionSnapshot {
    return dto.serializeSession(s, logCount);
  }
  snapshot(): Snapshot {
    return dto.snapshot({
      offices: this.offices,
      together: this.together,
      cats: this.cats,
      skins: this.skins,
      sessions: this.sessions.values(),
    });
  }
}
