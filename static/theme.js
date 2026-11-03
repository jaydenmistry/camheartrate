// Light or dark appearance: light by default, the choice kept per browser.
// Loaded in <head>, before the page paints, so a saved choice never flashes.
// A <div class="segmented" data-theme-switch> with Light and Dark buttons
// switches it (Theme.bind); pages redraw their charts in Theme.onChange.
(function () {
  const KEY = 'theme';
  const listeners = [];
  let theme = 'light';
  try { if (localStorage.getItem(KEY) === 'dark') theme = 'dark'; } catch (e) { /* storage blocked */ }
  document.documentElement.dataset.theme = theme;

  function sync(seg) {
    seg.dataset.value = theme;
    for (const b of seg.querySelectorAll('button[data-choice]')) {
      const on = b.dataset.choice === theme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-switch]').forEach(sync);
    listeners.forEach((f) => f(theme));
  }
  function set(next, { animate = true } = {}) {
    if (next === theme) return;
    theme = next;
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Cross-fade the whole page where the browser can (View Transitions). A
    // window that renders no frames (covered, minimised) never starts the
    // transition, so the change also applies on its own after 400 ms.
    if (animate && !still && document.startViewTransition) {
      let done = false;
      const once = () => { if (!done) { done = true; apply(); } };
      document.startViewTransition(once);
      setTimeout(once, 400);
    } else {
      apply();
    }
  }
  function bind(seg) {
    sync(seg);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-choice]');
      if (b) set(b.dataset.choice);
    });
    // A radio group: arrow keys move the choice.
    seg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      set(theme === 'light' ? 'dark' : 'light');
      seg.querySelector(`button[data-choice="${theme}"]`).focus();
    });
  }
  window.Theme = { get: () => theme, set, bind, onChange: (f) => listeners.push(f) };
})();
