// Hooks the views share: drawing again (now, or every so often), timers that end with the component, sets and maps
// of keys kept as state, and the two-click confirm.
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';

/** A function that draws the component again. */
export function useRedraw() {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  return () => redraw(0);
}

/** Draw the component again every `ms` while `on` (durations and places that change with time). */
export function useTick(ms: number, on = true) {
  const redraw = useRedraw();
  useEffect(() => {
    if (!on) return;
    const t = setInterval(redraw, ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

/**
 * One pending timeout: `later(fn, ms)` replaces the one waiting, if any, and none fires after the component is
 * gone (a dialog's delayed close mustn't reach the next dialog mounted in its place).
 */
export function useLater() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
}

/** A set of keys as state (rows with a request in flight, say), changed without copying it by hand. */
export function useKeySet<K>() {
  const [set, setSet] = useState<ReadonlySet<K>>(new Set());
  return {
    has: (k: K) => set.has(k),
    add: (k: K) => setSet((s) => (s.has(k) ? s : new Set(s).add(k))),
    delete: (k: K) =>
      setSet((s) => {
        if (!s.has(k)) return s;
        const n = new Set(s);
        n.delete(k);
        return n;
      }),
    /** Keep only the keys `keep` says are still wanted. */
    retain: (keep: (k: K) => boolean) =>
      setSet((s) => ([...s].every(keep) ? s : new Set([...s].filter(keep)))),
  };
}

/** A map of keys to values as state (a row's error message, say). */
export function useKeyMap<K, V>() {
  const [map, setMap] = useState<ReadonlyMap<K, V>>(new Map());
  return {
    get: (k: K) => map.get(k),
    set: (k: K, v: V) => setMap((m) => new Map(m).set(k, v)),
    delete: (k: K) =>
      setMap((m) => {
        if (!m.has(k)) return m;
        const n = new Map(m);
        n.delete(k);
        return n;
      }),
    clear: () => setMap((m) => (m.size ? new Map() : m)),
  };
}

/** Two-click confirm for destructive buttons: the key waiting for its confirming click, and the click (true: it confirms). */
export function useArm<K>(ms: number) {
  const [armed, setArmed] = useState<K | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return {
    is: (key: K) => armed === key,
    click(key: K) {
      if (armed === key) return true;
      setArmed(() => key);
      return false;
    },
    disarm: () => setArmed(null),
  };
}
