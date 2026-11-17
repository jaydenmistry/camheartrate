// Heart rate over the last 1 or 5 minutes, with numbered marks (presenter keys
// N, X, T). Drawn on a canvas from the controller's history.
import { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { cssVar, useTheme } from '../lib/theme.js';
import { Card, Segmented } from '../components/ui.jsx';
import { setWindow, st, ui } from './controller.js';

const SAMPLE_MS = 500;

function rgba(color, a) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// A smooth line through the points (midpoint quadratic curves).
function smooth(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) return;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function draw(canvas, span, dark) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line-strong'), accent = cssVar('--accent'),
        accent2 = cssVar('--accent-2'), solid = cssVar('--surface-solid'), mono = cssVar('--mono');
  const padR = 34, padT = 10, padB = 6;
  const plotW = W - padR, plotH = H - padT - padB;

  const now = performance.now(), spanMs = span * 1000;
  const shown = st.history.filter((p) => now - p.t <= spanMs + SAMPLE_MS);
  const pts = shown.filter((p) => p.bpm !== null);
  let lo = 60, hi = 100;
  if (pts.length) {
    const vals = pts.map((p) => p.bpm);
    lo = Math.floor((Math.min(...vals) - 4) / 10) * 10;
    hi = Math.ceil((Math.max(...vals) + 4) / 10) * 10;
    if (hi - lo < 20) { const mid = (hi + lo) / 2; lo = Math.floor((mid - 10) / 10) * 10; hi = lo + 20; }
  }
  const step = hi - lo > 60 ? 20 : 10;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  const x = (ts) => plotW * (1 - (now - ts) / spanMs);

  ctx.font = `500 11px ${mono}`;
  ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi; v += step) {
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, Math.round(y(v)) + 0.5); ctx.lineTo(plotW, Math.round(y(v)) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = muted; ctx.fillText(String(v), plotW + 8, y(v));
  }

  // Marks: a dashed line and the mark's number in a small pill.
  for (const m of st.marks) {
    if (now - m.t > spanMs) continue;
    const mx = Math.round(x(m.t)) + 0.5;
    ctx.save();
    ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(mx, padT + 16); ctx.lineTo(mx, padT + plotH); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(mx, padT + 6, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = solid; ctx.font = `600 10px ${mono}`; ctx.textAlign = 'center';
    ctx.fillText(String(m.n), mx, padT + 6.5);
    ctx.textAlign = 'start'; ctx.font = `500 11px ${mono}`;
  }

  if (!pts.length) {
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.font = `400 13px ${cssVar('--font')}`;
    ctx.fillText(`Your heart rate over the last ${span === 60 ? 'minute' : `${span / 60} minutes`} will draw here.`,
                 plotW / 2, padT + plotH / 2);
    ctx.textAlign = 'start';
    return;
  }

  // Split into runs so gaps (no reading) stay visible as breaks in the line.
  const runs = [];
  let run = [];
  for (const p of shown) {
    if (p.bpm === null) { if (run.length) runs.push(run); run = []; } else run.push(p);
  }
  if (run.length) runs.push(run);

  for (const r of runs) {
    const xy = r.map((p) => [x(p.t), y(p.bpm)]);
    const fill = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    fill.addColorStop(0, rgba(accent, dark ? 0.32 : 0.2)); fill.addColorStop(1, rgba(accent, 0));
    ctx.beginPath(); smooth(ctx, xy);
    ctx.lineTo(xy[xy.length - 1][0], padT + plotH); ctx.lineTo(xy[0][0], padT + plotH); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    const stroke = ctx.createLinearGradient(0, 0, plotW, 0);
    stroke.addColorStop(0, accent2); stroke.addColorStop(1, accent);
    ctx.save();
    if (dark) { ctx.shadowColor = rgba(accent, 0.8); ctx.shadowBlur = 12; }
    ctx.beginPath(); smooth(ctx, xy);
    ctx.strokeStyle = stroke; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }
  const last = st.history[st.history.length - 1];
  if (last && last.bpm !== null) {
    const lx = x(last.t), ly = y(last.bpm);
    ctx.beginPath(); ctx.arc(lx, ly, 9, 0, Math.PI * 2); ctx.fillStyle = rgba(accent, 0.18); ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = accent; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = solid; ctx.stroke();
  }
}

export default function Trend() {
  const ref = useRef(null);
  const { span, sample, note, blind, light } = useStore(ui, (s) => ({
    span: s.window, sample: s.sample, note: s.note, blind: s.check.on && !s.check.done, light: s.light,
  }));
  const [theme] = useTheme();
  const dark = theme === 'dark';

  useEffect(() => {
    // After the theme's colours have eased in.
    const c = ref.current;
    if (!c) return undefined;
    draw(c, span, dark);
    const t = setTimeout(() => draw(c, span, dark), 420);
    return () => clearTimeout(t);
  }, [span, sample, dark, light]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const ro = new ResizeObserver(() => draw(c, ui.get().window, document.documentElement.dataset.theme === 'dark'));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const label = span === 60 ? 'minute' : `${span / 60} minutes`;
  return (
    <Card className="trend card-pad" data-blind={blind ? '' : undefined}>
      <div className="card-head">
        <span className="eyebrow"><Activity aria-hidden="true" />Trend</span>
        <Segmented label="Time shown" value={span} onChange={setWindow} options={[
          { value: 60, label: '1 min' }, { value: 300, label: '5 min' },
        ]} />
      </div>
      <canvas ref={ref} role="img" aria-label={`Heart rate over the last ${label}`} />
      <div className="trend-axis"><span>{span === 60 ? '1 min ago' : `${span / 60} min ago`}</span><span>now</span></div>
      {note && (
        <div className="trend-note">
          {note.map(([text, bold], i) => (bold ? <b key={i}>{text}</b> : <span key={i}>{text}</span>))}
        </div>
      )}
    </Card>
  );
}
