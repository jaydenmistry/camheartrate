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
  // The colours ease to the new appearance: for a moment .theming gives every
  // element a colour transition (see the pages' CSS). A transition starts from the
  // colour on screen, so switching back mid-way turns around without a jump, and
  // nothing blocks input meanwhile. Reduced motion keeps it: it is a fade.
  let easing = 0;
  function set(next, { animate = true } = {}) {
    if (next === theme) return;
    theme = next;
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    const root = document.documentElement;
    if (animate) {
      root.classList.add('theming');
      clearTimeout(easing);
      easing = setTimeout(() => root.classList.remove('theming'), 450);
    }
    apply();
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
