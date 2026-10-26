// A minimal observable: one state object and its listeners. Changes go through update(), which mutates the state in
// place and says what changed; every subscriber then gets that change, in the order they subscribed.

export interface Store<S, C> {
  get(): S;
  /** Apply `fn` to the state; the change it returns goes to every subscriber, then back to the caller. */
  update(fn: (s: S) => C): C;
  /** Listen for changes; returns the unsubscribe function. */
  subscribe(fn: (change: C, s: S) => void): () => void;
}

export function createStore<S, C>(state: S): Store<S, C> {
  const subs = new Set<(change: C, s: S) => void>();
  return {
    get: () => state,
    update(fn) {
      const change = fn(state);
      for (const sub of subs) sub(change, state);
      return change;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
