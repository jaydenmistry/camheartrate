// A tiny external store: the measuring logic writes to it outside React, and
// components read just the slice they need, so a 30 Hz telemetry stream only
// re-renders what actually changed.
import { useRef, useSyncExternalStore } from 'react';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in next) if (!Object.is(state[k], next[k])) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...next };
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

export function shallow(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]));
}

export function useStore(store, selector = (s) => s, equal = shallow) {
  const memo = useRef(null);
  const snap = () => {
    const v = selector(store.get());
    if (memo.current && equal(memo.current.v, v)) return memo.current.v;
    memo.current = { v };
    return v;
  };
  return useSyncExternalStore(store.subscribe, snap, snap);
}
