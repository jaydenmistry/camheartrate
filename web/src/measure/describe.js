// What to tell the person, judged from the telemetry. Pure functions, ported
// unchanged in meaning from the original page.

export const LABEL = { face: 'your face', palm: 'your palm', skin: 'the outlined skin', simulated: 'the simulated face' };
export const METHOD = { POS: 'POS', CHROM: 'CHROM', GREEN: 'raw green channel' };
const MIN_SKIN_AREA = 0.004;    // skin smaller than this share of the picture: too far away
const MIN_BRIGHTNESS = 40;      // mean skin luma (0-255) below this: too little light

// The one thing most worth fixing right now, judged from what the camera sees.
export function problem(t, light) {
  if (t.source !== 'camera' || !t.region) return '';
  if (t.moving) return 'Hold still and stay quiet.';
  if (t.roi_pixels && t.frame && t.roi_pixels / (t.frame[0] * t.frame[1]) < MIN_SKIN_AREA) {
    return 'Move closer to the camera.';
  }
  if (t.brightness != null && t.brightness < MIN_BRIGHTNESS) {
    return light ? 'Not enough light. Turn your screen brightness all the way up.'
                 : 'Not enough light. Turn the screen light on, or face a lamp.';
  }
  if (t.clipped > 0.25) return 'Too much light on your skin. Move back from the light a little.';
  return '';
}

export function describe(t, { mode, light }) {
  const label = LABEL[t.region?.kind] || 'your skin';
  if (t.message) return ['warning', t.message, ''];
  if (t.source === 'idle') return ['none', t.loading || 'Starting the camera…', ''];
  const issue = problem(t, light);
  const hint = t.source !== 'camera' || t.region?.locked ? ''
    : mode === 'browser' ? 'Tap your face or palm to measure there.' : 'Tap any skin to measure there.';
  const truth = t.synthetic ? ` True rate ${Math.round(t.synthetic.bpm_actual ?? t.synthetic.bpm)} bpm.` : '';
  switch (t.status) {
    case 'NO SKIN': return ['none', mode === 'browser' ? 'Show your face or palm to the camera.'
                                                     : 'Show your face, palm or arm to the camera.', ''];
    case 'CALIBRATING': {
      if (issue) return ['warning', issue, ''];
      const left = Math.max(1, Math.ceil((t.min_buffer_s || 5) - (t.buffer_s || 0)));
      return ['measuring', `Measuring ${label}. Hold still for ${left} more second${left === 1 ? '' : 's'}.`, ''];
    }
    case 'LOCKED': return ['locked', `Reading ${label}.${truth}`, issue || hint];
    case 'WEAK SIGNAL': return issue ? ['warning', issue, '']
      : ['locked', `Weak signal from ${label}. More light will help.${truth}`, hint];
    case 'HIGH MOTION NOISE': return issue ? ['warning', issue, hint]
      : ['warning', t.bpm === null ? 'Almost there. Keep still.'
                                   : `Weak signal from ${label}. Add light or move a little closer.`, hint];
    default: return ['none', 'Connecting…', ''];
  }
}

// How far along the first reading is: the buffer filling (to 70 %), then the
// signal quality rising towards a lock. Null once there is a reading.
export function progressOf(t) {
  if (t.message || t.source === 'idle' || !t.region || t.bpm !== null || !t.status || t.status === 'NO SKIN') return null;
  const fill = Math.min(1, (t.buffer_s || 0) / (t.min_buffer_s || 5));
  return t.status === 'CALIBRATING' ? 0.7 * fill : 0.7 + 0.3 * Math.min(1, (t.sqi || 0) / 50);
}

export const SIGNAL_TEXT = ['no signal', 'weak signal', 'fair signal', 'good signal', 'strong signal'];
export function signalLevel(t) {
  const judged = t.region && t.status && !['CALIBRATING', 'NO SKIN'].includes(t.status) && !t.message;
  if (!judged) return null;
  const sqi = t.sqi || 0;
  return sqi < 30 ? 0 : sqi < 40 ? 1 : sqi < 50 ? 2 : sqi < 70 ? 3 : 4;
}

export function median(xs) {
  const v = xs.slice().sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Rate from the median gap between taps; gaps that look like a doubled or
// missed tap (faster than 220 or slower than 30 bpm) are dropped.
export function tappedRate(taps) {
  const gaps = [];
  for (let i = 1; i < taps.length; i++) {
    const g = (taps[i] - taps[i - 1]) / 1000;
    if (g >= 0.27 && g <= 2.0) gaps.push(g);
  }
  return gaps.length < 5 ? null : 60 / median(gaps);
}
