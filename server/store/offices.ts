// The offices (one per repo, or everyone in one) and the desk each session was given, remembered across restarts.
import type { Layout } from '../../shared/layout.ts';
import {
  cloneOffice,
  DEFAULT_OFFICE,
  deskCount,
  normalize,
  validate,
} from '../../shared/layout.ts';
import { DESK_MEMORY_MS } from '../config.ts';
import {
  absorbRepos,
  DEFAULT_OFFICE_ID,
  DEFAULT_OFFICE_NAME,
  defaultOffice,
  newOffice,
  newOfficeId,
  officeOfRepo,
  pickDesk,
  type RepoResolver,
} from '../domain/office.ts';
import type { DeskMemory, Office, Session } from '../types.ts';
import type { EventBus } from './events.ts';

export class OfficeRepo {
  offices: Office[];
  together: string | null;
  desks: Record<string, DeskMemory>;
  events: EventBus;
  save: () => void;
  repoOf: RepoResolver;

  constructor({
    events,
    save,
    repoOf,
  }: {
    events: EventBus;
    save: () => void;
    repoOf: RepoResolver;
  }) {
    this.offices = [defaultOffice()]; // one per repo; repos: repo keys that work there
    this.together = null; // office id everyone works in regardless of repo, or null: each repo in its own office
    this.desks = {}; // sessionId -> { desk, office, at, terminal? }
    this.events = events;
    this.save = save;
    this.repoOf = repoOf;
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

  office(id: string | null) {
    return this.offices.find((o) => o.id === id);
  }
  emit() {
    this.events.emit('offices', {
      offices: this.offices,
      together: this.together,
    });
  }
  /** Persist and push the office list after a change. */
  commit() {
    this.save();
    this.emit();
  }
  /** The office a working directory belongs to: its repo's, created (with the default layout) the first time. */
  officeFor(cwd?: string) {
    const repo = this.repoOf(cwd);
    let o = officeOfRepo(this.offices, repo);
    if (!o) {
      o = newOffice(newOfficeId(), repo.name || DEFAULT_OFFICE_NAME, [
        repo.key,
      ]);
      this.offices.push(o);
      this.commit();
    }
    return o.id;
  }
  setLayout(officeId: string, layout: Layout) {
    this.office(officeId)!.layout = layout;
  }
  rename(officeId: string, name: string) {
    this.office(officeId)!.name = name;
    this.commit();
  }
  /** Drop an office; its repos (and `together`, if it was the one) go to the default office. Not committed yet. */
  remove(officeId: string) {
    const o = this.office(officeId)!,
      home = this.office(DEFAULT_OFFICE_ID)!;
    absorbRepos(home, o);
    this.offices = this.offices.filter((x) => x !== o);
    if (this.together === officeId) this.together = DEFAULT_OFFICE_ID;
  }
  deskCount(officeId: string | null) {
    return deskCount(this.office(officeId)!.layout);
  }

  /** A desk for `sessionId` in `officeId` (see pickDesk), remembered. `sessions`: everyone, to see who sits where. */
  assignDesk(
    sessionId: string,
    officeId: string | null,
    sessions: Iterable<Session>,
  ) {
    const used = new Set<number | null>();
    for (const s of sessions)
      if (!s.ended && s.id !== sessionId && s.officeId === officeId)
        used.add(s.desk);
    const remembered = this.desks[sessionId];
    const desk = pickDesk(used, this.deskCount(officeId), officeId, remembered);
    this.desks[sessionId] = {
      ...remembered,
      desk,
      office: officeId ?? undefined,
      at: Date.now(),
    };
    this.save();
    return desk;
  }
  /** The terminal handle remembered with a session's desk (a server restart keeps it). */
  terminalOf(sessionId: string) {
    return this.desks[sessionId]?.terminal || null;
  }
  rememberTerminal(sessionId: string, handle: string) {
    const d = this.desks[sessionId];
    if (d) {
      d.terminal = handle;
      this.save();
    }
  }
  releaseDesk(sessionId: string) {
    delete this.desks[sessionId];
    this.save();
  }
}
