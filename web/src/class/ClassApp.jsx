// Projector view: how many people are connected, and everyone's heart rate.
// Polls /api/class once a second. Nothing here identifies anyone.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { QRCodeSVG } from 'qrcode.react';
import { Eraser, HeartPulse, Table2 } from 'lucide-react';
import { Backdrop, BrandMark, Card, ThemeSwitch } from '../components/ui.jsx';
import HeartWall from './HeartWall.jsx';
import { Histogram, Scatter, binsOf } from './Charts.jsx';

// Opened as /class?presenter=<RPPG_PRESENTER_KEY>: offer to clear the pulse checks (e.g. after a rehearsal).
const PRESENTER_KEY = new URLSearchParams(location.search).get('presenter') || '';
const JOIN_URL = `${location.origin}/`;
const EMPTY = { connected: 0, readings: [], median: null, hearts: [], checks: [] };

const rise = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: (i = 0) => ({ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' },
                      transition: { type: 'spring', stiffness: 240, damping: 30, delay: 0.07 * i } }),
};

function useClassData() {
  const [data, setData] = useState(EMPTY);
  const [ok, setOk] = useState(null);
  useEffect(() => {
    let timer = 0, live = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/class', { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        const d = await res.json();
        if (live) { setData(d); setOk(true); }
      } catch {
        if (live) setOk(false);
      }
      if (live) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return [data, ok];
}

function Stat({ label, value, children, i }) {
  return (
    <Card className="stat" variants={rise} initial="hidden" animate="show" custom={i}>
      <span className="stat-value">{children ?? (value === null ? '–' : <NumberFlow value={value} />)}</span>
      <span className="stat-label">{label}</span>
    </Card>
  );
}

export default function ClassApp() {
  const [d, ok] = useClassData();
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(0);
  const r = d.readings || [];
  const checks = d.checks || [];

  const reset = async () => {
    if (!confirm('Clear everyone\'s pulse checks from the class view?')) return;
    let text, bad;
    try {
      const res = await fetch('/api/class/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ key: PRESENTER_KEY }) });
      text = res.ok ? 'Pulse checks cleared.' : 'The server did not accept that presenter key.';
      bad = !res.ok;
    } catch {
      text = 'Could not reach the server.'; bad = true;
    }
    setNotice({ text, bad });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  const diffs = checks.map(([a, b]) => Math.abs(a - b)).sort((a, b) => a - b);
  const close = diffs.filter((x) => x <= 5).length;
  const status = notice || (ok === false ? { text: 'Lost the connection to the server. Retrying…', bad: true }
    : ok ? { text: 'Live. Nothing here identifies anyone: one heart per connected camera.' } : { text: 'Connecting…' });
  const rows = binsOf(r).counts.map((c, i) => [binsOf(r).lo + i * 5, c]).filter(([, c]) => c);

  return (
    <MotionConfig reducedMotion="user">
      <Backdrop />
      <div className="class-shell">
        <motion.header className="class-head" variants={rise} initial="hidden" animate="show" custom={0}>
          <div className="class-title">
            <BrandMark />
            <h1>Heart rates <span className="grad">in this room</span></h1>
          </div>
          <Card className="join" spot={false}>
            <div className="qr" aria-hidden="true">
              <QRCodeSVG value={JOIN_URL} size={300} level="M" bgColor="#ffffff" fgColor="#0b0b10" marginSize={0} />
            </div>
            <div className="join-text">
              <span className="eyebrow">Measure yours at</span>
              <span className="join-url">{JOIN_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
            </div>
          </Card>
        </motion.header>

        <section className="stats" aria-label="Summary">
          <Stat i={1} label="connected" value={d.connected} />
          <Stat i={2} label="with a reading" value={r.length} />
          <Stat i={3} label="median bpm" value={d.median === null ? null : Math.round(d.median)} />
          <Stat i={4} label="range, bpm">{r.length ? `${Math.round(r[0])}–${Math.round(r[r.length - 1])}` : '–'}</Stat>
        </section>

        <motion.div variants={rise} initial="hidden" animate="show" custom={5}>
          <HeartWall hearts={d.hearts || []} />
        </motion.div>

        <motion.section className={`charts${checks.length ? '' : ' single'}`} variants={rise} initial="hidden" animate="show" custom={6} layout>
          <Card as="figure" className="card-pad" layout>
            <div className="card-head"><span className="card-title">Everyone's heart rate</span></div>
            <Histogram readings={r} median={d.median} />
            <figcaption>One dot per person, grouped in 5 bpm steps. Readings update every second.</figcaption>
          </Card>
          <AnimatePresence>
            {checks.length > 0 && (
              <Card as="figure" className="card-pad" key="checks" layout
                    initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}>
                <div className="card-head">
                  <span className="eyebrow"><HeartPulse aria-hidden="true" />Pulse checks</span>
                </div>
                <div className="card-title">Camera vs. finger on the pulse</div>
                <Scatter checks={checks} />
                <figcaption>
                  {checks.length} pulse check{checks.length === 1 ? '' : 's'}. Camera within 5 bpm of the finger
                  for {close} of {checks.length}; typical gap {Math.round(diffs[Math.floor(diffs.length / 2)])} bpm.
                  Dots on the diagonal agree exactly.
                </figcaption>
              </Card>
            )}
          </AnimatePresence>
        </motion.section>

        <details className="table">
          <summary><Table2 aria-hidden="true" />Show as a table</summary>
          <table>
            <thead><tr><th>bpm</th><th>people</th></tr></thead>
            <tbody>{rows.map(([from, c]) => <tr key={from}><td>{from}–{from + 4}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </details>

        <footer className="class-foot">
          <span className={`class-status${status.bad ? ' bad' : ''}`} role="status">
            <i data-state={ok ? 'live' : ok === false ? 'lost' : 'wait'} />{status.text}
          </span>
          <div className="class-foot-right">
            {PRESENTER_KEY && (
              <motion.button className="chip" onClick={reset} whileTap={{ scale: 0.95 }}>
                <Eraser aria-hidden="true" />Clear pulse checks
              </motion.button>
            )}
            <ThemeSwitch />
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
