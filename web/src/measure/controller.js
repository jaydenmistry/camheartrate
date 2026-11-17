// The measuring page's logic, outside React: the WebSocket to the server, this
// browser's own camera (static/browser.js), the pulse magnifier
// (static/magnify.js), the heart-rate history, marks, the pulse check and the
// demo keys. It writes what the page shows into `ui`; components read from it.
// Behaviour follows the original page one for one.
import { createStore } from '../lib/store.js';
import { prefersReducedMotion } from '../lib/theme.js';
import { describe, progressOf, signalLevel, METHOD, median, tappedRate } from './describe.js';

const HISTORY_S = 300, SAMPLE_MS = 500;   // kept; the graph shows the last 1 or 5 minutes
const CHECK_S = 15;
// A deployed page only offers the demo keys to the presenter: open it with ?presenter=<RPPG_PRESENTER_KEY>.
export const PRESENTER_KEY = new URLSearchParams(location.search).get('presenter') || '';
const reduceMotion = prefersReducedMotion();
const Theme = window.Theme;

function savedLight() {
  let on = true;
  try { on = localStorage.getItem('screenLight') !== 'off'; } catch { /* storage blocked */ }
  if (Theme?.get() === 'dark') on = false;        // the screen light is a white page
  return on;
}

export const ui = createStore({
  view: null,          // what render() worked out from the latest telemetry
  mode: 'server',
  connected: null,
  light: savedLight(),
  gotFrame: false,
  toast: null,         // { id, text }
  mag: { on: false, strength: 60, mirror: false },
  check: { on: false, done: false, text: '', hits: 0 },
  window: 60,          // seconds of history in the graph
  note: null,          // the line under the graph after a mark
  sample: 0,           // bumps with every history sample, so the graph redraws
});

// Read every frame by the 3D heart and the canvases; never rendered by React.
export const st = { tele: null, noticeId: null, hr: null, history: [], lastSample: 0, marks: [], wave: null };
export const pulse = { phase: 0, beat: 0, active: false, live: false, bpm: null };

const els = { img: null, cam: null, mag: null };
const beatTargets = new Set();
let ws = null, browserCam = null, mode = 'server', dirty = false, booted = false;

// ------------------------------------------------------------- wiring from components
export const attach = (name) => (el) => { els[name] = el; };
// Elements that get the --beat CSS variable (0-1) every frame, for the flush and the dot.
export const beatRef = (el) => {
  if (!el) return undefined;
  beatTargets.add(el);
  return () => beatTargets.delete(el);
};

// ------------------------------------------------------------- what the page shows
// The server's telemetry, with this browser's camera, skin region and messages
// laid over it while that camera is the source.
function current() {
  const t = st.tele || { status: null, bpm: null };
  const lost = ui.get().connected === false;
  if (!browserCam || t.source === 'synthetic') {
    return lost ? { ...t, message: 'Lost the connection to the server. Retrying…' } : t;
  }
  const local = browserCam.telemetry();
  if (lost && !local.message) local.message = 'Lost the connection to the server. Retrying…';
  return { ...t, ...local };
}

// ------------------------------------------------------------- screen light
export function setLight(on, announce) {
  if (on && Theme?.get() === 'dark') Theme.set('light');
  document.documentElement.dataset.light = on ? 'on' : 'off';
  try { localStorage.setItem('screenLight', on ? 'on' : 'off'); } catch { /* ignore */ }
  ui.set({ light: on, sample: ui.get().sample + 1 });
  if (announce) toast(on ? 'Screen light on. Turn your display brightness all the way up.' : 'Screen light off');
  if (announce && browserCam) browserCam.settle();      // the light on the skin changed
}

// ------------------------------------------------------------- connection
function connect() {
  const query = PRESENTER_KEY ? `?presenter=${encodeURIComponent(PRESENTER_KEY)}` : '';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${query}`);
  ws.binaryType = 'blob';
  ws.onopen = () => { ui.set({ connected: true }); dirty = true; };
  ws.onclose = () => { ui.set({ connected: false }); dirty = true; setTimeout(connect, 1000); };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') { st.tele = JSON.parse(ev.data); dirty = true; return; }
    const url = URL.createObjectURL(ev.data);
    const img = els.img;
    if (!img) { URL.revokeObjectURL(url); return; }
    const prev = img.src;
    img.src = url;
    if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
    if (!ui.get().gotFrame) { ui.set({ gotFrame: true }); dirty = true; }
  };
}
export const send = (msg) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

// ------------------------------------------------------------- input
// x, y: 0-1 across the stage as shown.
export function tapStage(x, y) {
  if (browserCam) browserCam.tap(1 - x, y);           // the view is mirrored
  else send({ type: 'select', x, y });
}
export const releaseSkin = () => (browserCam ? browserCam.release() : send({ type: 'auto' }));
export function switchCamera(id, name) {
  if (!id) return;
  if (browserCam) browserCam.switchTo(id); else send({ type: 'camera', value: id });
  toast(`Switching to ${name}`);
}

// ------------------------------------------------------------- toast
let toastN = 0;
export function toast(text) { ui.set({ toast: { id: ++toastN, text } }); }

// ------------------------------------------------------------- pulse magnifier
// Amplifies the colour change in the video itself, so the skin visibly flushes
// on each beat (magnify.js). Runs in this browser only; nothing extra is sent.
let magTool = null;
export async function setMagnify(on) {
  if (on && !magTool) {
    const url = '/static/magnify.js';
    const { Magnifier } = await import(/* @vite-ignore */ url);
    magTool = new Magnifier(els.mag);
    magTool.setStrength(ui.get().mag.strength);
  }
  ui.set({ mag: { ...ui.get().mag, on } });
  if (on) toast('Hold very still: movement is magnified too.');
  dirty = true;
  if (magTool) { magSource(); magTool.setOn(on); }
}
export function setMagStrength(s) {
  const strength = Math.max(0, Math.min(150, s));
  ui.set({ mag: { ...ui.get().mag, strength } });
  if (magTool) magTool.setStrength(strength);
}
// Magnify whatever is on screen: this browser's camera (mirrored), or frames from the server.
function magSource() {
  if (!magTool) return;
  const cam = !!browserCam && st.tele?.source !== 'synthetic';
  magTool.setSource(cam ? els.cam : els.img);
  if (ui.get().mag.mirror !== cam) ui.set({ mag: { ...ui.get().mag, mirror: cam } });
}

// ------------------------------------------------------------- marks
// For a live experiment (exercise, then rest; a breath-hold): N drops a
// numbered mark on the graph, and the line under it compares the heart rate
// then with now. T switches the graph between the last 1 and 5 minutes.
export function setWindow(s) { ui.set({ window: s }); refresh(); }
function addMark() {
  st.marks.push({ t: performance.now(), n: st.marks.length + 1 });
  if (ui.get().window === 60) ui.set({ window: 300 });
  toast(`Mark ${st.marks.length}`);
  refresh();
}
function refresh() { ui.set({ note: markNote(), sample: ui.get().sample + 1 }); }

// The reading nearest a moment, within 3 s.
function bpmAt(ts) {
  let best = null;
  for (const p of st.history) {
    if (p.bpm !== null && Math.abs(p.t - ts) <= 3000 && (!best || Math.abs(p.t - ts) < Math.abs(best.t - ts))) best = p;
  }
  return best ? best.bpm : null;
}
const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v))}`;
// Segments of the line under the graph: [text, bold].
function markNote() {
  const m = st.marks[st.marks.length - 1];
  if (!m) return null;
  const now = performance.now(), then = bpmAt(m.t), cur = st.hr;
  const since = st.history.filter((p) => p.t >= m.t && p.bpm !== null).map((p) => p.bpm);
  const parts = [[`Since mark ${m.n} (${clock(now - m.t)} ago): `, false]];
  if (then === null) parts.push(['no reading at the mark.', false]);
  else {
    if (cur === null) parts.push([`${Math.round(then)}`, true], [' bpm then, no reading now. ', false]);
    else {
      parts.push([`${Math.round(then)} → ${Math.round(cur)}`, true],
        [` bpm, ${signed(cur - then)} (${signed((cur - then) / then * 100)}%). `, false]);
    }
    if (since.length) parts.push([`Lowest ${Math.round(Math.min(...since))}, highest ${Math.round(Math.max(...since))}. `, false]);
    const later = now - m.t >= 60000 ? bpmAt(m.t + 60000) : null;
    if (later !== null) parts.push([`One minute after: ${Math.round(later)} (${signed(later - then)}).`, false]);
  }
  return parts;
}

// ------------------------------------------------------------- demo keys
// Demo controls stay off screen: 1/2/3 method, S simulation, arrows tune the simulation,
// M magnifier, [ and ] its strength, N mark, X clear marks, T 1 or 5 minutes.
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (chk.on && !chk.done && e.key === ' ') { e.preventDefault(); if (!e.repeat) tapBeat(); return; }
  if (!st.tele) return;
  const t = st.tele, sim = t.synthetic;
  if (mode === 'browser' && !t.presenter) return;
  if (e.target instanceof HTMLInputElement) return;
  const methods = { 1: 'POS', 2: 'CHROM', 3: 'GREEN' };
  const s = ui.get();
  if (e.key === 'm' || e.key === 'M') {
    setMagnify(!s.mag.on);
  } else if (e.key === 'n' || e.key === 'N') {
    addMark();
  } else if ((e.key === 'x' || e.key === 'X') && st.marks.length) {
    st.marks = []; toast('Marks cleared'); refresh();
  } else if (e.key === 't' || e.key === 'T') {
    setWindow(s.window === 60 ? 300 : 60);
  } else if (s.mag.on && (e.key === '[' || e.key === ']')) {
    setMagStrength(s.mag.strength + (e.key === ']' ? 10 : -10));
  } else if (methods[e.key]) {
    send({ type: 'algorithm', value: methods[e.key] });
    toast(`Method: ${METHOD[methods[e.key]]}`);
  } else if (e.key === 's' || e.key === 'S') {
    const to = t.source === 'synthetic' ? 'camera' : 'synthetic';
    send({ type: 'source', value: to });
    if (browserCam) browserCam.setActive(to === 'camera');
    toast(to === 'synthetic' ? 'Simulation on' : 'Camera on');
  } else if (sim && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const bpm = Math.max(60, Math.min(160, sim.bpm + (e.key === 'ArrowUp' ? 5 : -5)));
    send({ type: 'synthetic', bpm }); toast(`Simulated heart rate ${bpm} bpm`); e.preventDefault();
  } else if (sim && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const motion = Math.max(0, Math.min(1, Math.round((sim.motion + (e.key === 'ArrowRight' ? 0.1 : -0.1)) * 10) / 10));
    send({ type: 'synthetic', motion }); toast(`Simulated movement ${Math.round(motion * 100)}%`); e.preventDefault();
  }
}

// ------------------------------------------------------------- pulse check
// Tap along with a finger on your wrist or neck and compare with the camera.
const chk = { on: false, done: false, taps: [], camera: [], timer: 0 };
const round = Math.round;
const setCheck = (patch) => ui.set({ check: { ...ui.get().check, ...patch } });

export function startCheck() {
  clearTimeout(chk.timer);
  Object.assign(chk, { on: true, done: false, taps: [], camera: [] });
  setCheck({ on: true, done: false, hits: 0,
    text: `Find your pulse on your wrist or neck. Tap the button, or press the space bar, on every beat for ${CHECK_S} seconds.` });
}
export function closeCheck() {
  clearTimeout(chk.timer);
  chk.on = false;
  setCheck({ on: false, done: false, text: '', hits: 0 });
}
export function tapBeat() {
  if (!chk.on || chk.done) return;
  const now = performance.now();
  chk.taps.push(now);
  if (chk.taps.length === 1) chk.timer = setTimeout(finishCheck, CHECK_S * 1000);
  const rate = tappedRate(chk.taps), n = chk.taps.length;
  const left = Math.max(1, Math.ceil(CHECK_S - (now - chk.taps[0]) / 1000));
  setCheck({ hits: n, text: `${n} beat${n === 1 ? '' : 's'}${rate ? `, about ${round(rate)} bpm` : ''}. `
    + `Keep going for ${left} more second${left === 1 ? '' : 's'}.` });
  if (navigator.vibrate) navigator.vibrate(8);       // a haptic tick, on phones that have one
}
function finishCheck() {
  chk.done = true;
  const tapped = tappedRate(chk.taps);
  const camera = chk.camera.length ? median(chk.camera) : null;
  let text;
  if (!tapped) {
    text = 'Not enough steady taps to work out your pulse. Try again, tapping on every beat.';
  } else if (camera === null) {
    text = `You tapped ${round(tapped)} bpm. The camera had no steady reading meanwhile, so hold still and try again.`;
  } else {
    const gap = Math.abs(tapped - camera);
    text = `You tapped ${round(tapped)} bpm and the camera read ${round(camera)} bpm: `
      + (gap <= 5 ? 'a good match.' : gap <= 10 ? `${round(gap)} bpm apart, close.`
         : `${round(gap)} bpm apart. Hold still, add light and try again.`);
    if (mode === 'browser') send({ type: 'check', tapped, camera });
  }
  setCheck({ done: true, text, result: tapped ? { tapped: round(tapped), camera: camera === null ? null : round(camera) } : null });
}

// ------------------------------------------------------------- render
const LIVE = ['LOCKED', 'WEAK SIGNAL', 'HIGH MOTION NOISE'];
function render(t) {
  const s = ui.get();
  const [phase, main, hint] = describe(t, { mode, light: s.light });
  const sim = t.source === 'synthetic';
  const outline = t.region?.outline || [];
  const cam = t.camera, cams = t.cameras || [];
  const other = cam && cams.find((c) => c.id !== cam.id);
  const live = t.bpm !== null && t.bpm !== undefined && LIVE.includes(t.status);
  const view = {
    phase, main, hint,
    ar: t.frame ? t.frame[0] / t.frame[1] : null,
    roi: outline.map((poly) => 'M' + poly.map((p) => `${p[0]} ${p[1]}`).join('L') + 'Z').join(''),
    showCam: !!browserCam && !sim,
    placeholder: browserCam ? (sim ? !s.gotFrame : browserCam.state !== 'camera') : !s.gotFrame,
    source: t.source || null,
    region: t.region?.kind || null,
    showAuto: !!(t.region && t.region.locked),
    showCheck: t.source === 'camera' && !!t.region,
    showMag: t.source === 'camera' || sim,
    modeText: cam ? `${cam.height}p · ${Math.round(cam.fps)} fps${cam.held ? ' · exposure held' : ''}` : '',
    camId: other ? other.id : null,
    camName: other ? other.name : null,
    camLabel: other ? `Use ${other.name}${other.fps > cam.fps ? ` (${Math.round(other.fps)} fps)` : ''}` : null,
    showWave: mode === 'server' || !!t.presenter,
    classHref: mode === 'browser' && t.presenter ? `/class?presenter=${encodeURIComponent(PRESENTER_KEY)}` : null,
    progress: progressOf(t),
    signal: signalLevel(t),
    bpm: live ? Math.round(t.bpm) : null,
    quality: !live ? 'none' : t.status === 'HIGH MOTION NOISE' ? 'poor' : 'good',
    simulated: sim,
    method: t.algorithm || null,
  };
  ui.set({ view });
  if (s.mag.on) magSource();

  if (t.bvp && t.bvp.t && t.bvp.t.length) st.wave = { ...t.bvp, at: performance.now() };
  st.hr = live && t.status !== 'HIGH MOTION NOISE' ? t.bpm : null;
  if (chk.on && !chk.done && chk.taps.length && st.hr) chk.camera.push(st.hr);

  if (t.notice) {
    if (st.noticeId !== null && t.notice.id !== st.noticeId && t.notice.text) toast(t.notice.text);
    st.noticeId = t.notice.id;
  }

  const now = performance.now();
  if (now - st.lastSample >= SAMPLE_MS) {
    st.lastSample = now;
    st.history.push({ t: now, bpm: st.hr });
    while (st.history.length && now - st.history[0].t > HISTORY_S * 1000 + SAMPLE_MS) st.history.shift();
    refresh();
  }
}

// ------------------------------------------------------------- frame loop
let lastTs = performance.now();
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
  if (dirty) { dirty = false; render(current()); }
  const s = ui.get();
  // Nothing on screen beats while the screen light is on (the page is lighting the
  // skin, so a beat drawn on it would reach the camera), while magnifying (every
  // colour change on screen is then the camera's) or during a pulse check.
  const active = !!st.hr && !reduceMotion && !s.light && !chk.on && !s.mag.on;
  let beat = 0;
  if (active) {
    pulse.phase = (pulse.phase + dt * st.hr / 60) % 1;
    beat = pulse.phase < 0.12 ? pulse.phase / 0.12 : Math.exp(-(pulse.phase - 0.12) * 7);   // fast rise, slow fall
  }
  pulse.active = active; pulse.beat = beat; pulse.live = st.hr !== null; pulse.bpm = st.hr;
  const b = beat.toFixed(3);
  for (const el of beatTargets) el.style.setProperty('--beat', b);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------- start
export async function boot() {
  if (booted) return;
  booted = true;
  setLight(ui.get().light, false);
  // Appearance: dark is a dark page, so it turns the screen light off.
  Theme?.onChange((theme) => {
    if (theme === 'dark' && ui.get().light) {
      setLight(false, false);
      toast('Dark mode. The screen light is off; turn it on for more light on your skin.');
    }
    refresh();
  });
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(frame);
  let config = {};
  try { config = await (await fetch('/api/config')).json(); } catch { /* older server */ }
  mode = config.mode || mode;
  ui.set({ mode });
  if (mode === 'browser') {
    const url = '/static/browser.js';
    const { BrowserCamera } = await import(/* @vite-ignore */ url);
    browserCam = new BrowserCamera(els.cam, { send, onChange: () => { dirty = true; }, onNotice: toast,
                                              localAssets: !!config.local_assets });
    browserCam.start();
  }
  connect();
}

// Development only (npm run dev): poke the page from the console, e.g. __rppg.startCheck().
if (import.meta.env.DEV) window.__rppg = { ui, st, pulse, startCheck, closeCheck, tapBeat, toast, setLight, setWindow };
