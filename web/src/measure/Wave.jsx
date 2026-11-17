// The extracted pulse (after the colour projection and filtering), as it
// arrives about 4 times a second. It scrolls left between arrivals so it moves
// smoothly; dots mark the beats the peak finder picked.
import { useEffect, useRef } from 'react';
import { Waves } from 'lucide-react';
import { cssVar } from '../lib/theme.js';
import { Card } from '../components/ui.jsx';
import { st } from './controller.js';

const WAVE_S = 6;

function draw(cv) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const dark = document.documentElement.dataset.theme === 'dark';
  const accent = cssVar('--accent'), accent2 = cssVar('--accent-2'), solid = cssVar('--surface-solid');
  ctx.strokeStyle = cssVar('--line-strong'); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(0, Math.round(H / 2) + 0.5); ctx.lineTo(W, Math.round(H / 2) + 0.5); ctx.stroke();
  ctx.setLineDash([]);
  const w = st.wave, age = w ? (performance.now() - w.at) / 1000 : Infinity;
  if (age > 1.5) {
    ctx.fillStyle = cssVar('--muted'); ctx.font = `400 13px ${cssVar('--font')}`; ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('The pulse wave draws here once there is a signal.', W / 2, H / 2 - 14);
    ctx.textAlign = 'start';
    return;
  }
  const x = (tr) => W * (1 + (tr - age) / WAVE_S);
  const y = (v) => H / 2 - Math.max(-3, Math.min(3, v)) / 3 * (H / 2 - 8);
  // Older pulse fades out to the left.
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.25, accent2); grad.addColorStop(1, accent);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  if (dark) { ctx.shadowColor = accent; ctx.shadowBlur = 14; }
  ctx.beginPath();
  w.t.forEach((tr, i) => (i ? ctx.lineTo(x(tr), y(w.y[i])) : ctx.moveTo(x(tr), y(w.y[i]))));
  ctx.strokeStyle = grad; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.shadowBlur = 0;
  for (const i of w.peaks || []) {
    const px = x(w.t[i]);
    if (px < 0 || px > W) continue;
    ctx.beginPath(); ctx.arc(px, y(w.y[i]), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = accent; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = solid; ctx.stroke();
  }
  ctx.restore();
}

export default function Wave() {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => { if (ref.current) draw(ref.current); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <Card className="wave card-pad" aria-label="Pulse wave">
      <div className="card-head">
        <span className="eyebrow"><Waves aria-hidden="true" />Pulse wave · last 6 seconds</span>
        <span className="card-sub">each dot is a heartbeat</span>
      </div>
      <canvas ref={ref} />
    </Card>
  );
}
