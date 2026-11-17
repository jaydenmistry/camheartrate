// Small shared pieces: the backdrop, glass cards, the Light / Dark switch,
// signal bars, the brand mark and an error boundary for WebGL.
import { Component, forwardRef, useCallback, useId } from 'react';
import { motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { HEART_PATH } from '../lib/heartPath.js';
import { useTheme } from '../lib/theme.js';

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="blob a" />
      <div className="blob b" />
      <div className="blob c" />
    </div>
  );
}

// A glass card. With `spot`, a soft light follows the pointer across it.
export const Card = forwardRef(function Card({ spot = true, className = '', as = 'section', children, ...rest }, ref) {
  const Tag = motion[as];
  const move = useCallback((e) => {
    const el = e.currentTarget, r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
    el.style.setProperty('--spot', '1');
  }, []);
  const leave = useCallback((e) => e.currentTarget.style.setProperty('--spot', '0'), []);
  return (
    <Tag ref={ref} className={`card ${className}`} data-spot={spot ? '' : undefined}
         onPointerMove={spot ? move : undefined} onPointerLeave={spot ? leave : undefined} {...rest}>
      {children}
    </Tag>
  );
});

// A radio group with a sliding thumb.
export function Segmented({ value, options, onChange, label, size }) {
  const id = useId();
  const onKey = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? options.length - 1 : 1)) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => document.getElementById(`${id}-${next.value}`)?.focus());
  };
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={onKey} data-size={size}
         style={{ '--n': options.length, '--i': index }}>
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} id={`${id}-${o.value}`} role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  onClick={() => onChange(o.value)} aria-label={o.label ? undefined : o.title}>
            {o.icon}{o.label && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeSwitch({ compact }) {
  const [theme, setTheme] = useTheme();
  return (
    <Segmented label="Appearance" value={theme} onChange={setTheme} options={[
      { value: 'light', label: compact ? null : 'Light', icon: <Sun aria-hidden="true" />, title: 'Light' },
      { value: 'dark', label: compact ? null : 'Dark', icon: <Moon aria-hidden="true" />, title: 'Dark' },
    ]} />
  );
}

export const SIGNAL_TEXT = ['no signal', 'weak signal', 'fair signal', 'good signal', 'strong signal'];
export function SignalBars({ level }) {
  if (level === null || level === undefined) return null;
  return (
    <span className="signal">
      <span className="bars" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} className={i < level ? 'on' : ''} />)}</span>
      <span>{SIGNAL_TEXT[level]}</span>
    </span>
  );
}

export function HeartGlyph(props) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d={HEART_PATH} /></svg>;
}

export function BrandMark() {
  return <span className="brand-mark"><HeartGlyph /></span>;
}

// A flat, glossy SVG heart: shown while the 3D one loads, or where WebGL is unavailable.
export function FlatHeart({ className = 'hero-flat' }) {
  const id = useId();
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <defs>
          <radialGradient id={`${id}g`} cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#ff8aa3" />
            <stop offset="0.45" stopColor="#ff2d55" />
            <stop offset="1" stopColor="#a3002a" />
          </radialGradient>
        </defs>
        <path d={HEART_PATH} fill={`url(#${id}g)`} />
      </svg>
    </div>
  );
}

export class WebGLBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn('3D view unavailable, showing a flat one instead:', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}
