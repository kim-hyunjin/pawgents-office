// What the store tells the outside (SSE, tests): `type` is an SSE event name, `data` its JSON payload.
export type Listener = (type: string, data: unknown) => void;

export class EventBus {
  listeners: Set<Listener>;
  constructor() {
    this.listeners = new Set();
  }
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners) fn(type, data);
  }
}
