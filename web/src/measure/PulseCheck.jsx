// Pulse check: tap along with a finger on your wrist or neck, then compare
// the tapped rate with the camera's. The camera's number is blurred meanwhile.
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, HeartPulse, X } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { Card } from '../components/ui.jsx';
import { closeCheck, tapBeat, ui } from './controller.js';

function TapButton({ hits }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    // pointerdown, not click: it fires the instant a finger lands; the space bar is handled by the controller.
    <motion.button ref={ref} className="tap" onPointerDown={(e) => { e.preventDefault(); tapBeat(); }}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) tapBeat(); } }}
                   whileTap={{ scale: 0.95, transition: { duration: 0.08 } }}
                   transition={{ type: 'spring', stiffness: 600, damping: 26 }}>
      <HeartPulse aria-hidden="true" />Tap on each beat
      {/* Each tap sends a ring out from the button (a new key restarts it). */}
      {hits > 0 && (
        <motion.span key={hits} className="tap-ripple" initial={{ opacity: 0.85, scale: 1 }}
                     animate={{ opacity: 0, scale: 1.4 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
      )}
    </motion.button>
  );
}

export default function PulseCheck() {
  const check = useStore(ui, (s) => s.check);
  return (
    <AnimatePresence>
      {check.on && (
        <Card key="check" className="check" aria-live="polite"
              initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
          <div className="card-head">
            <span className="eyebrow"><HeartPulse aria-hidden="true" />Pulse check</span>
          </div>
          <p>{check.text}</p>
          {check.done && check.result && (
            <div className="check-result">
              <div className="check-stat"><span>Your finger</span><b>{check.result.tapped}</b></div>
              <div className="check-stat"><span>The camera</span><b>{check.result.camera ?? '–'}</b></div>
            </div>
          )}
          <div className="check-row">
            {!check.done && <TapButton hits={check.hits} />}
            <motion.button className="chip" onClick={closeCheck} whileTap={{ scale: 0.95 }}>
              {check.done ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{check.done ? 'Close' : 'Cancel'}
            </motion.button>
          </div>
        </Card>
      )}
    </AnimatePresence>
  );
}
