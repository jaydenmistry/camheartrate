// Wall of hearts: lays out one cell per connected camera, in the order people
// joined, and draws the hearts in 3D (HeartWall3D) with their rates as HTML
// underneath. Without WebGL, flat SVG hearts beat with CSS instead.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Heart } from 'lucide-react';
import { useTheme } from '../lib/theme.js';
import { HEART_PATH } from '../lib/heartPath.js';
import { Card, WebGLBoundary, hasWebGL } from '../components/ui.jsx';

const HeartWall3D = lazy(() => import('./HeartWall3D.jsx'));

const sizeFor = (n) => (n <= 8 ? 150 : n <= 20 ? 110 : n <= 40 ? 84 : n <= 80 ? 62 : 48);

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function FlatWall({ items, layout }) {
  return items.map((it, i) => {
    const [x, y] = layout.css(i);
    const s = layout.size * 0.84;
    return (
      <svg key={it.id} className={`flat-heart${it.bpm === null ? ' waiting' : ''}`} viewBox="0 0 24 24"
           style={{ left: x - s / 2, top: y - s / 2, width: s, height: s,
                    animationDuration: it.bpm ? `${60 / it.bpm}s` : undefined }}>
        <path d={HEART_PATH} />
      </svg>
    );
  });
}

export default function HeartWall({ hearts }) {
  const box = useRef(null);
  const width = useWidth(box);
  const [theme] = useTheme();
  const gl = useMemo(hasWebGL, []);
  const items = useMemo(() => hearts.map(([id, bpm]) => ({ id: String(id), bpm })), [hearts]);
  const n = items.length;

  const layout = useMemo(() => {
    const size = sizeFor(n);
    const labelH = Math.max(18, Math.round(size * 0.26));
    const cols = Math.max(1, Math.floor((width || 800) / size));
    const cellW = (width || 800) / cols;
    const rowH = size + labelH;
    const rows = Math.max(1, Math.ceil(n / cols));
    const W = width || 800, H = rows * rowH;
    const css = (i) => [((i % cols) + 0.5) * cellW, Math.floor(i / cols) * rowH + size / 2];
    // World coordinates for the orthographic camera: origin in the middle, y up.
    const at = (i) => { const [x, y] = css(i); return [x - W / 2, H / 2 - y]; };
    return { size, labelH, cols, cellW, rowH, rows, W, H, css, at };
  }, [n, width]);

  return (
    <Card className="wall card-pad" aria-label="Every heart in the room">
      <div className="card-head">
        <span className="eyebrow"><Heart aria-hidden="true" fill="currentColor" />Every heart in the room</span>
        <span className="card-sub">Each heart beats at the rate its own camera measures. Grey hearts are still measuring.</span>
      </div>
      <div className="wall-box" ref={box} style={{ height: n ? layout.H : 140 }}>
        {n > 0 && (gl ? (
          <WebGLBoundary fallback={<FlatWall items={items} layout={layout} />}>
            <Suspense fallback={null}>
              <HeartWall3D items={items} layout={layout} theme={theme} />
            </Suspense>
          </WebGLBoundary>
        ) : <FlatWall items={items} layout={layout} />)}
        <AnimatePresence>
          {items.map((it, i) => {
            const [x, y] = layout.css(i);
            return (
              <motion.span key={it.id} className={`wall-label${it.bpm === null ? ' waiting' : ''}`}
                           aria-label={it.bpm === null ? 'measuring' : `${Math.round(it.bpm)} bpm`}
                           initial={{ opacity: 0, left: x, top: y + layout.size / 2 + 2 }}
                           animate={{ opacity: 1, left: x, top: y + layout.size / 2 + 2 }}
                           exit={{ opacity: 0 }} style={{ fontSize: Math.max(13, layout.size * 0.19) }}
                           transition={{ type: 'spring', stiffness: 200, damping: 28 }}>
                {it.bpm === null ? '…' : Math.round(it.bpm)}
              </motion.span>
            );
          })}
        </AnimatePresence>
        <AnimatePresence>
          {n === 0 && (
            <motion.div className="wall-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={HEART_PATH} /></svg>
              A heart appears here for everyone who joins.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
