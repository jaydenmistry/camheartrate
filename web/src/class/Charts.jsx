// The class charts, as SVG: everyone's heart rate (one dot per person in 5 bpm
// columns) and the pulse checks (finger against camera, with a ±5 bpm band).
// New dots pop in; colours are CSS variables so Light / Dark ease without a redraw.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const BIN = 5;
const pop = { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0, opacity: 0 },
              transition: { type: 'spring', stiffness: 420, damping: 22 } };

function useWidth(fallback) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Tip({ tip }) {
  return (
    <AnimatePresence>
      {tip && (
        <motion.div className="tip" style={{ left: tip.x, top: tip.y }}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}>
          {tip.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Dot fill: a small vertical gradient in the accent colours (CSS variables, so it follows the theme).
function DotGradient({ id }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--accent-2)' }} />
        <stop offset="1" style={{ stopColor: 'var(--accent)' }} />
      </linearGradient>
    </defs>
  );
}

export function binsOf(readings) {
  const lo = Math.min(50, Math.floor((Math.min(...readings, 999) - BIN) / BIN) * BIN);
  const hi = Math.max(130, Math.ceil((Math.max(...readings, 0) + BIN) / BIN) * BIN);
  const bins = (hi - lo) / BIN;
  const counts = new Array(bins).fill(0);
  for (const r of readings) counts[Math.min(bins - 1, Math.max(0, Math.floor((r - lo) / BIN)))]++;
  return { lo, hi, bins, counts };
}

export function Histogram({ readings, median }) {
  const [ref, W] = useWidth(800);
  const [tip, setTip] = useState(null);
  const H = Math.round(Math.min(420, Math.max(220, W * 0.36)));
  const padL = 8, padR = 8, padT = 30, padB = 30;
  const { lo, hi, bins, counts } = binsOf(readings);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const binW = plotW / bins, x = (v) => padL + (v - lo) / (hi - lo) * plotW, base = padT + plotH;
  const tallest = Math.max(1, ...counts);
  const rad = Math.max(4, Math.min(binW * 0.4, (plotH / tallest) / 2 - 1, 16));
  const ticks = [];
  for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) ticks.push(v);
  const show = (e, text) => {
    const r = ref.current.getBoundingClientRect();
    setTip({ text, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Heart rates of everyone with a reading, one dot per person">
        <DotGradient id="histDot" />
        <line x1={padL} x2={W - padR} y1={base + 0.5} y2={base + 0.5} style={{ stroke: 'var(--line-strong)' }} />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={base} y2={base + 5} style={{ stroke: 'var(--line-strong)' }} />
            <text x={x(v)} y={base + 20} textAnchor="middle">{v}</text>
          </g>
        ))}
        {!readings.length && (
          <text className="empty" x={W / 2} y={padT + plotH / 2} textAnchor="middle">Dots appear here as people get a reading.</text>
        )}
        {median !== null && readings.length > 0 && (
          <motion.g initial={false} animate={{ x: x(median) }} transition={{ type: 'spring', stiffness: 120, damping: 20 }}>
            <line x1={0} x2={0} y1={padT - 8} y2={base} className="median-line" />
            <text x={0} y={padT - 14} textAnchor="middle" className="median-text">median {Math.round(median)}</text>
          </motion.g>
        )}
        <AnimatePresence>
          {counts.flatMap((c, i) => Array.from({ length: c }, (_, k) => {
            const from = lo + i * BIN;
            return (
              <motion.circle key={`${from}-${k}`} cx={padL + (i + 0.5) * binW} cy={base - rad - 1 - k * (2 * rad + 2)} r={rad}
                             fill="url(#histDot)" style={{ stroke: 'var(--surface-solid)', transformBox: 'fill-box', transformOrigin: 'center' }}
                             strokeWidth={2} {...pop} />
            );
          }))}
        </AnimatePresence>
        {counts.map((c, i) => {
          const from = lo + i * BIN;
          return c ? (
            <rect key={from} x={padL + i * binW} y={padT} width={binW} height={plotH} fill="transparent"
                  onPointerMove={(e) => show(e, `${from}–${from + BIN - 1} bpm · ${c} ${c === 1 ? 'person' : 'people'}`)}
                  onPointerLeave={() => setTip(null)} />
          ) : null;
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

export function Scatter({ checks }) {
  const [ref, S] = useWidth(360);
  const [tip, setTip] = useState(null);
  const pad = 36, plot = S - pad - 10;
  const all = checks.flat();
  const lo = Math.min(50, Math.floor((Math.min(...all) - 5) / 10) * 10);
  const hi = Math.max(120, Math.ceil((Math.max(...all) + 5) / 10) * 10);
  const sx = (v) => pad + (v - lo) / (hi - lo) * plot, sy = (v) => 10 + plot - (v - lo) / (hi - lo) * plot;
  const band = [[lo, lo + 5], [hi - 5, hi], [hi, hi], [hi, hi - 5], [lo + 5, lo], [lo, lo]].map(([a, b]) => `${sx(a)},${sy(b)}`).join(' ');
  const ticks = [];
  for (let v = lo; v <= hi; v += 20) ticks.push(v);
  const show = (e, text) => {
    const r = ref.current.getBoundingClientRect();
    setTip({ text, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Pulse checks: tapped rate against camera rate">
        <DotGradient id="scatterDot" />
        <polygon points={band} className="band" />
        <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} style={{ stroke: 'var(--line-strong)' }} />
        <line x1={pad} x2={pad + plot} y1={10 + plot + 0.5} y2={10 + plot + 0.5} style={{ stroke: 'var(--line-strong)' }} />
        <line x1={pad - 0.5} x2={pad - 0.5} y1={10} y2={10 + plot} style={{ stroke: 'var(--line-strong)' }} />
        {ticks.map((v) => (
          <g key={v}>
            <text x={sx(v)} y={10 + plot + 18} textAnchor="middle">{v}</text>
            <text x={pad - 6} y={sy(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={pad + plot} y={10 + plot - 8} textAnchor="end">finger →</text>
        <text x={pad + 6} y={22}>↑ camera</text>
        <AnimatePresence>
          {checks.map(([tapped, camera], i) => (
            <motion.circle key={`${i}-${tapped}-${camera}`} cx={sx(tapped)} cy={sy(camera)} r={6.5} fill="url(#scatterDot)"
                           style={{ stroke: 'var(--surface-solid)', transformBox: 'fill-box', transformOrigin: 'center' }}
                           strokeWidth={2} {...pop} />
          ))}
        </AnimatePresence>
        {checks.map(([tapped, camera], i) => (
          <circle key={i} cx={sx(tapped)} cy={sy(camera)} r={14} fill="transparent"
                  onPointerMove={(e) => show(e, `finger ${Math.round(tapped)} · camera ${Math.round(camera)} bpm`)}
                  onPointerLeave={() => setTip(null)} />
        ))}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}
