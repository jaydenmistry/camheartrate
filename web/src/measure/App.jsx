import { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Backdrop, BrandMark, ThemeSwitch } from '../components/ui.jsx';
import { boot, ui } from './controller.js';
import Stage from './Stage.jsx';
import StatusBar from './StatusBar.jsx';
import PulseCheck from './PulseCheck.jsx';
import HeartHero from './HeartHero.jsx';
import Trend from './Trend.jsx';
import Wave from './Wave.jsx';

// Blocks rise into place one after another.
const rise = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  // filter ends as 'none': a leftover blur(0) would cut the glass cards' backdrop blur short.
  show: (i = 0) => ({ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' },
                      transition: { type: 'spring', stiffness: 260, damping: 30, delay: 0.06 * i } }),
};

function LivePill() {
  const connected = useStore(ui, (s) => s.connected);
  const state = connected === true ? 'live' : connected === false ? 'lost' : 'wait';
  return (
    <span className="live-pill" data-state={state} role="status">
      <i />{state === 'live' ? 'Live' : state === 'lost' ? 'Reconnecting' : 'Connecting'}
    </span>
  );
}

export default function App() {
  useEffect(() => { boot(); }, []);
  const showWave = useStore(ui, (s) => !!s.view?.showWave);
  const ar = useStore(ui, (s) => s.view?.ar ?? null);
  const mode = useStore(ui, (s) => s.mode);
  return (
    <MotionConfig reducedMotion="user">
      <Backdrop />
      <div className="shell" style={ar ? { '--ar': ar.toFixed(4) } : undefined}>
        <motion.header className="topbar" variants={rise} initial="hidden" animate="show" custom={0}>
          <div className="brand">
            <BrandMark />
            <div>
              <h1>Camera Heart Rate</h1>
              <p>Your pulse from the colour of your skin. No sensors, no contact.</p>
            </div>
          </div>
          <div className="topbar-right">
            <LivePill />
            <ThemeSwitch />
          </div>
        </motion.header>

        <main className="layout">
          <motion.div className="col" variants={rise} initial="hidden" animate="show" custom={1}>
            <Stage />
            <StatusBar />
            <PulseCheck />
          </motion.div>
          <motion.div className="col" variants={rise} initial="hidden" animate="show" custom={2}>
            <HeartHero />
            <Trend />
          </motion.div>
        </main>

        <AnimatePresence>
          {showWave && (
            <motion.div key="wave" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 30, delay: 0.2 }}>
              <Wave />
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="foot">
          <span>Measures the tiny colour change of your skin on each heartbeat (rPPG).
            {mode === 'browser' ? ' Video never leaves your browser.' : ''} Not a medical device.</span>
          <span>Tap the camera view to choose which skin to measure.</span>
        </footer>
      </div>
    </MotionConfig>
  );
}
