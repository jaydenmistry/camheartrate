// The heart outline as an SVG path (24 x 24), kept apart from three.js so the
// flat pages can use it without loading the 3D code.
export const HEART_PATH = 'M12 21C12 21 3 14.6 3 8.6A4.6 4.6 0 0 1 12 6.4A4.6 4.6 0 0 1 21 8.6C21 14.6 12 21 12 21Z';

// Fast rise, slower fall, with a smaller second bump: lub-dub. p is 0-1 through a beat.
export function lubDub(p) {
  const bump = (c, w, a) => a * Math.exp(-(((p - c) / w) ** 2));
  return bump(0.06, 0.045, 1) + bump(0.24, 0.05, 0.45);
}
