// The camera view: frames from the server (<img>) or this browser's camera
// (<video>), the outline of the skin being measured, and the overlays.
import { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { attach, beatRef, setMagStrength, tapStage, ui } from './controller.js';

const imgRef = attach('img'), camRef = attach('cam'), magRef = attach('mag');

function Toast() {
  const toast = useStore(ui, (s) => s.toast);
  const shown = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    shown.current = toast.id;
    const t = setTimeout(() => { if (ui.get().toast?.id === toast.id) ui.set({ toast: null }); }, 2200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div role="status" aria-live="polite">
      <AnimatePresence>
        {toast && (
          // In and out along the same path: up from the bottom edge, back down to it.
          <motion.div key={toast.id} className="toast glass"
                      initial={{ opacity: 0, x: '-50%', y: 14, scale: 0.96, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, x: '-50%', y: 0, scale: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, x: '-50%', y: 10, scale: 0.97, filter: 'blur(4px)' }}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MagControl() {
  const mag = useStore(ui, (s) => s.mag);
  return (
    <AnimatePresence>
      {mag.on && (
        <motion.div className="mag-ctl glass" onClick={(e) => e.stopPropagation()}
                    initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.94, filter: 'blur(4px)' }}>
          <label htmlFor="magRange">{mag.strength ? `Colour change ×${mag.strength}` : 'Colour change ×0, as the camera sees it'}</label>
          <input type="range" id="magRange" min="0" max="150" step="10" value={mag.strength}
                 onChange={(e) => setMagStrength(Number(e.target.value))} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Stage() {
  const v = useStore(ui, (s) => ({
    roi: s.view?.roi ?? '',
    phase: s.view?.phase ?? 'none',
    showCam: !!s.view?.showCam,
    placeholder: s.view ? s.view.placeholder : true,
    progress: s.view?.progress ?? null,
    simulated: !!s.view?.simulated,
    source: s.view?.source ?? null,
    modeText: s.view?.modeText ?? '',
    mode: s.mode,
  }));
  const mag = useStore(ui, (s) => s.mag);
  const box = useRef(null);
  const setBox = useCallback((el) => { box.current = el; return beatRef(el); }, []);

  const onClick = (e) => {
    const r = box.current.getBoundingClientRect();
    tapStage((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const live = v.source === 'camera' || v.simulated;
  const label = v.simulated ? 'Simulation' : v.source === 'camera' ? 'Live camera' : 'Starting';

  return (
    <div className="stage" data-phase={v.phase} ref={setBox} onClick={onClick}>
      <img className="media" ref={imgRef} hidden={v.showCam} alt="Live camera view. Tap any skin to measure there." />
      <video className="media mirror" ref={camRef} playsInline muted hidden={!v.showCam}
             aria-label="Live camera view. Tap your face or palm to measure there." />
      <canvas className={`media mag${mag.mirror ? ' mirror' : ''}`} ref={magRef} hidden={!mag.on}
              aria-label="The camera view with the pulse's colour change magnified" />
      <svg className="roi-layer" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        <path className="roi" d={v.roi} />
      </svg>

      <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      {v.phase === 'measuring' && !mag.on && <div className="scan" aria-hidden="true" />}

      {!v.placeholder && (
        <div className="badge glass" data-live={live}>
          <i /><span>{label}</span>{v.modeText && <span>{v.modeText}</span>}
        </div>
      )}

      <AnimatePresence>
        {v.placeholder && (
          <motion.div className="placeholder" exit={{ opacity: 0, transition: { duration: 0.4 } }}>
            <span className="spinner" aria-hidden="true" />
            <span>Starting the camera…</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {v.progress !== null && (
          <motion.div className="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.span animate={{ scaleX: v.progress }} initial={{ scaleX: 0 }}
                         transition={{ type: 'spring', stiffness: 120, damping: 24 }} />
          </motion.div>
        )}
      </AnimatePresence>

      <MagControl />
      <Toast />
    </div>
  );
}
