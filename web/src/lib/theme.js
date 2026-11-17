// Light / Dark, kept by /static/theme.js (loaded before paint). This hook
// follows it from React.
import { useEffect, useState } from 'react';

const T = () => window.Theme;

export function useTheme() {
  const [theme, setTheme] = useState(() => T()?.get() ?? 'light');
  useEffect(() => {
    if (!T()) return undefined;
    let live = true;
    T().onChange((t) => { if (live) setTheme(t); });
    setTheme(T().get());
    return () => { live = false; };
  }, []);
  return [theme, (next) => T()?.set(next)];
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
