// The reading: the 3D heart behind the big number, signal quality above it.
import { Suspense, lazy, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { Heart } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { useTheme } from '../lib/theme.js';
import { Card, FlatHeart, SignalBars, WebGLBoundary, hasWebGL } from '../components/ui.jsx';
import { beatRef, ui } from './controller.js';

const HeartScene = lazy(() => import('./HeartScene.jsx'));

export default function HeartHero() {
  const r = useStore(ui, (s) => ({
    bpm: s.view?.bpm ?? null,
    quality: s.view?.quality ?? 'none',
    signal: s.view?.signal ?? null,
    blind: s.check.on && !s.check.done,
    light: s.light,
    paused: s.light && s.view?.bpm != null,
  }));
  const [theme] = useTheme();
  const gl = useMemo(hasWebGL, []);

  return (
    <Card className="hero" ref={beatRef} aria-label="Heart rate">
      <div className="hero-glow" aria-hidden="true" />
      {gl ? (
        <WebGLBoundary fallback={<FlatHeart />}>
          <Suspense fallback={<FlatHeart />}>
            <HeartScene theme={theme} light={r.light} />
          </Suspense>
        </WebGLBoundary>
      ) : <FlatHeart />}

      <div className="hero-head">
        <span className="eyebrow"><Heart aria-hidden="true" fill="currentColor" />Heart rate</span>
        <AnimatePresence>
          {r.signal !== null && (
            <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SignalBars level={r.signal} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="hero-reading" data-quality={r.quality} data-blind={r.blind ? '' : undefined}>
        <div className="bpm-row">
          {/* The number rolls to each new value, digit by digit. */}
          {r.bpm !== null
            ? <NumberFlow className="bpm" value={r.bpm} transformTiming={{ duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }} />
            : <span className="bpm">–</span>}
          <span className="unit" title="beats per minute">BPM</span>
        </div>
        <AnimatePresence>
          {r.paused && (
            <motion.span className="hero-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              The heart stays still while the screen light is on, so nothing on screen flickers in time with your pulse.
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
