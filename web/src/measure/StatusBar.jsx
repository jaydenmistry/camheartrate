// One line of status (the one thing most worth fixing), then the controls.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, HeartPulse, Maximize2, Minimize2, ScanEye, Sun, SunDim, SwitchCamera, Users } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { beatRef, releaseSkin, setLight, setMagnify, startCheck, switchCamera, ui } from './controller.js';

const pop = {
  initial: { opacity: 0, scale: 0.9, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9 },
  transition: { type: 'spring', stiffness: 500, damping: 34 },
  whileTap: { scale: 0.95 },
};

function useFullscreen() {
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  return on;
}

export default function StatusBar() {
  const v = useStore(ui, (s) => ({
    phase: s.view?.phase ?? 'none',
    main: s.view?.main ?? (s.connected === false ? 'Lost the connection to the server. Retrying…' : 'Connecting…'),
    hint: s.view?.hint ?? '',
    showAuto: !!s.view?.showAuto,
    showCheck: !!s.view?.showCheck && !(s.check.on && !s.check.done),
    showMag: !!s.view?.showMag,
    camId: s.view?.camId ?? null,
    camName: s.view?.camName ?? null,
    camLabel: s.view?.camLabel ?? null,
    classHref: s.view?.classHref ?? null,
  }));
  const magOn = useStore(ui, (s) => s.mag.on);
  const light = useStore(ui, (s) => s.light);
  const full = useFullscreen();
  const canFull = !!document.documentElement.requestFullscreen;

  return (
    <div className="statusbar" data-phase={v.phase} ref={beatRef}>
      <div className="status-text" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <motion.span key={v.main} className="status-main"
                     initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {v.main}
        </motion.span>
        {v.hint && <span className="status-hint">{v.hint}</span>}
      </div>
      <div className="chips">
        <AnimatePresence initial={false}>
          {v.classHref && (
            <motion.a key="class" className="chip" href={v.classHref} target="_blank" rel="noopener" {...pop}>
              <Users aria-hidden="true" />Class view
            </motion.a>
          )}
          {v.showCheck && (
            <motion.button key="check" className="chip solid" onClick={startCheck} {...pop}>
              <HeartPulse aria-hidden="true" />Check with your pulse
            </motion.button>
          )}
          {v.showMag && (
            <motion.button key="mag" className="chip" aria-pressed={magOn} onClick={() => setMagnify(!magOn)} {...pop}>
              <ScanEye aria-hidden="true" />{magOn ? 'Stop magnifying' : 'Magnify the pulse'}
            </motion.button>
          )}
          {v.showAuto && (
            <motion.button key="auto" className="chip" onClick={releaseSkin} {...pop}>
              <Crosshair aria-hidden="true" />Pick skin automatically
            </motion.button>
          )}
          {v.camId && (
            <motion.button key="cam" className="chip" onClick={() => switchCamera(v.camId, v.camName)} {...pop}>
              <SwitchCamera aria-hidden="true" />{v.camLabel}
            </motion.button>
          )}
          <motion.button key="light" className="chip" aria-pressed={light} onClick={() => setLight(!light, true)} {...pop}>
            {light ? <Sun aria-hidden="true" /> : <SunDim aria-hidden="true" />}
            {light ? 'Screen light on' : 'Screen light off'}
          </motion.button>
          {canFull && (
            <motion.button key="full" className="chip" {...pop}
                           onClick={() => (document.fullscreenElement ? document.exitFullscreen()
                             : document.documentElement.requestFullscreen().catch(() => {}))}>
              {full ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              {full ? 'Exit full screen' : 'Full screen'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
