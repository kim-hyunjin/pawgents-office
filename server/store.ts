// The server's state, one object for everyone who needs it: a facade over the parts in server/store/
// (sessions, offices and desks, settings, the state file, the event bus). Rules that span them, like where a
// session sits, live here; the parts themselves know nothing of each other.
import fs from 'node:fs';
import path from 'node:path';
import { field } from '../shared/json.ts';
import type { Layout } from '../shared/layout.ts';
import { SKINS_DIR, STATE_FILE } from './config.ts';
import { DEFAULT_OFFICE_ID, type RepoResolver } from './domain/office.ts';
import {
  markRevived,
  newSession,
  type SessionInit,
  type SubagentInit,
  setState,
} from './domain/session.ts';
import * as files from './domain/worked-files.ts';
import * as dto from './http/dto.ts';
import { repoOf as gitRepoOf } from './repo.ts';
import { EventBus, type Listener } from './store/events.ts';
import { OfficeRepo } from './store/offices.ts';
import { Persistence } from './store/persistence.ts';
import { SessionRepo } from './store/sessions.ts';
import { SettingsRepo } from './store/settings.ts';
import type {
  Backend,
  Entity,
  EntityState,
  LogEntry,
  Session,
  SessionSnapshot,
  Skin,
  Snapshot,
  Subagent,
  SubagentSnapshot,
} from './types.ts';

export { BREED_KEY } from './store/settings.ts';
export type { SessionInit, SubagentInit };
export { DEFAULT_OFFICE_ID };

/** A file's mtime, or null when it is gone. */
function mtimeOf(file: string) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export class Store {
  events: EventBus;
  persistence: Persistence;
  settings: SettingsRepo;
  officeRepo: OfficeRepo;
  sessionRepo: SessionRepo;

  /** `repoOf`: which repo (so which office) a working directory belongs to; git by default. */
  constructor({
    stateFile = STATE_FILE,
    skinsDir = SKINS_DIR,
    repoOf = gitRepoOf,
  }: {
    stateFile?: string;
    skinsDir?: string;
    repoOf?: RepoResolver;
  } = {}) {
    const events = new EventBus(),
      save = () => this.save();
    this.events = events;
    this.settings = new SettingsRepo({ skinsDir, events, save });
    this.officeRepo = new OfficeRepo({ events, save, repoOf });
    this.sessionRepo = new SessionRepo({ events });
    this.persistence = new Persistence(stateFile, () => ({
      desks: this.desks,
      cats: this.cats,
      skins: this.skins,
      offices: this.offices,
      together: this.together,
    }));
  }

  get sessions() {
    return this.sessionRepo.sessions;
  }
  get desks() {
    return this.officeRepo.desks;
  }
  get offices() {
    return this.officeRepo.offices;
  }
  get together() {
    return this.officeRepo.together;
  }
  get cats() {
    return this.settings.cats;
  }
  get skins() {
    return this.settings.skins;
  }

  // ---- persistence -------------------------------------------------------
  load() {
    const data = this.persistence.read();
    this.officeRepo.loadDesks(field(data, 'desks'));
    this.settings.loadSkins(field(data, 'skins'));
    this.settings.loadCats(field(data, 'cats')); // after skins: a pick of a skin that is gone is dropped
    this.officeRepo.loadOffices(
      field(data, 'offices'),
      field(data, 'together'),
    );
  }
  /** Write the state file soon (debounced). */
  save() {
    this.persistence.save();
  }
  saveNow() {
    this.persistence.saveNow();
  }

  // ---- events --------------------------------------------------------------
  on(fn: Listener) {
    return this.events.on(fn);
  }
  emit(type: string, data: unknown) {
    this.events.emit(type, data);
  }
  emitSession(s: Session) {
    this.sessionRepo.emit(s);
  }
  /** Change session `s` in `fn` and push it to the browser (see SessionRepo.update: `false` means no change). */
  updateSession<T>(s: Session, fn: (s: Session) => T): T {
    return this.sessionRepo.update(s, fn);
  }

  // ---- settings ------------------------------------------------------------
  setCat(fam: string, breed: string | null) {
    this.settings.setCat(fam, breed);
  }
  emitSettings() {
    this.settings.emit();
  }
  commitSettings() {
    this.settings.commit();
  }
  skinFile(id: string) {
    return this.settings.skinFile(id);
  }
  hasBreed(breed: string) {
    return this.settings.hasBreed(breed);
  }
  addSkin(skin: Omit<Skin, 'id'>, png: Buffer) {
    return this.settings.addSkin(skin, png);
  }
  removeSkin(id: string) {
    return this.settings.removeSkin(id);
  }

  // ---- offices --------------------------------------------------------------
  office(id: string | null) {
    return this.officeRepo.office(id);
  }
  emitOffices() {
    this.officeRepo.emit();
  }
  commitOffices() {
    this.officeRepo.commit();
  }
  officeFor(cwd?: string) {
    return this.officeRepo.officeFor(cwd);
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
    this.officeRepo.together = officeId;
    for (const s of this.sessions.values())
      this.updateSession(s, () => this.placeSession(s));
    this.commitOffices();
  }
  /** Sessions in an office whose desk is gone (layout shrank) get a free one, if any. */
  reseat(officeId: string) {
    const n = this.officeRepo.deskCount(officeId);
    for (const s of this.sessions.values()) {
      if (s.ended || s.officeId !== officeId || s.desk === null || s.desk < n)
        continue;
      this.updateSession(s, () => {
        s.desk = this.assignDesk(s.id, officeId);
      });
    }
  }
  setLayout(officeId: string, layout: Layout) {
    this.officeRepo.setLayout(officeId, layout);
    this.reseat(officeId);
    this.commitOffices();
  }
  renameOffice(officeId: string, name: string) {
    this.officeRepo.rename(officeId, name);
  }
  /** Close an office: its repos and staff move to the default office. */
  deleteOffice(officeId: string) {
    this.officeRepo.remove(officeId);
    for (const s of this.sessions.values()) {
      if (s.officeId !== officeId) continue;
      this.updateSession(s, () => {
        s.officeId = DEFAULT_OFFICE_ID;
        if (!s.ended) s.desk = this.assignDesk(s.id, DEFAULT_OFFICE_ID);
      });
    }
    this.commitOffices();
  }

  // ---- desks ---------------------------------------------------------------
  assignDesk(sessionId: string, officeId: string | null) {
    return this.officeRepo.assignDesk(
      sessionId,
      officeId,
      this.sessions.values(),
    );
  }
  /**
   * Link a session to the terminal its backend types into (an Orca terminal handle, today); remembered with the desk
   * so a server restart keeps it. Held in `orcaTerminal`, the field's name on the wire.
   */
  bindTerminal(s: Session, handle?: string | null) {
    if (!handle || s.orcaTerminal === handle) return;
    s.orcaTerminal = handle;
    this.officeRepo.rememberTerminal(s.id, handle);
  }
  setBackend(s: Session, backend: Backend | null) {
    return this.sessionRepo.setBackend(s, backend);
  }
  releaseDesk(sessionId: string) {
    this.officeRepo.releaseDesk(sessionId);
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
    s = newSession(id, init, this.officeRepo.terminalOf(id));
    this.sessions.set(id, s);
    this.placeSession(s);
    return s;
  }
  revive(s: Session) {
    markRevived(s);
    s.desk = this.assignDesk(s.id, s.officeId);
  }
  endSession(s: Session, reason = 'ended') {
    this.sessionRepo.end(s, reason);
  }
  getOrCreateSubagent(
    s: Session,
    agentId: string,
    init: SubagentInit = {},
  ): Subagent {
    return this.sessionRepo.getOrCreateSubagent(s, agentId, init);
  }
  endSubagent(a: Subagent) {
    this.sessionRepo.endSubagent(a);
  }
  setState(ent: Entity, state: EntityState) {
    setState(ent, state);
  }
  log(s: Session, entry: Omit<LogEntry, 't'>) {
    this.sessionRepo.log(s, entry);
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
    this.sessionRepo.gc((id) => this.releaseDesk(id));
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
