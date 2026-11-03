// Eulerian video magnification of colour (Wu et al., SIGGRAPH 2012): makes the
// pulse's tiny colour change in the skin visible.
//
// Every frame is blurred heavily (averaged down to 40 pixels wide, about level 5
// of a Gaussian pyramid) so each pixel averages several hundred camera pixels
// and the sensor noise drops away. The last averaging step is done in floating
// point: the pulse is under one colour level, and an 8-bit canvas would round
// it away. Each pixel's colour over time then goes through a
// band-pass filter for 45-180 bpm (Butterworth high-pass at 0.75 Hz and
// low-pass at 3 Hz), the result is multiplied by the strength, and it is laid
// back over the video. The band is fixed and wide, not tuned to the measured
// rate: what flushes on screen is the change the camera really recorded, and
// a narrow filter would turn noise into a convincing-looking beat.
//
// Movement gets amplified as much as blood does, so it needs a still subject.

const MID_W = 320;             // the frame is drawn this wide, then averaged in blocks of
const BLOCK = 8;               // BLOCK x BLOCK pixels to SMALL_W wide
const SMALL_W = MID_W / BLOCK;
const OUT_W = 640;             // widest drawn output
const BAND = [0.75, 3.0];      // Hz
const MAX_SHIFT = 60;          // most a pixel's colour is moved, in 0-255 levels
const RAMP_S = 2;              // strength fades in after a (re)start, while the filters settle

export class Magnifier {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mid = document.createElement('canvas');
    this.midCtx = this.mid.getContext('2d', { willReadFrequently: true });
    this.delta = document.createElement('canvas');
    this.deltaCtx = this.delta.getContext('2d');
    this.strength = 60;
    this.source = null;
    this.on = false;
    this.reset();
  }

  // el: a <video> (the browser's camera) or <img> (frames from the server).
  setSource(el) {
    if (el === this.source) return;
    this.detach();
    this.source = el;
    this.reset();
    if (this.on) this.attach();
  }

  setOn(on) {
    if (on === this.on) return;
    this.on = on;
    this.canvas.hidden = !on;
    if (on) { this.reset(); this.attach(); } else this.detach();
  }

  setStrength(s) { this.strength = Math.max(0, Math.min(150, s)); }

  reset() {
    this.n = 0; this.fs = 0; this.coeffFs = 0; this.lastMs = 0; this.startMs = 0;
  }

  attach() {
    const el = this.source;
    if (!el) return;
    const token = this.token = {};
    if (el instanceof HTMLVideoElement && el.requestVideoFrameCallback) {
      const loop = (now) => { if (this.token !== token) return; this.frame(now); el.requestVideoFrameCallback(loop); };
      el.requestVideoFrameCallback(loop);
    } else if (el instanceof HTMLVideoElement) {
      let lastTime = -1;
      const loop = (now) => {
        if (this.token !== token) return;
        if (el.currentTime !== lastTime) { lastTime = el.currentTime; this.frame(now); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } else {
      this.onLoad = () => { if (this.token === token) this.frame(performance.now()); };
      el.addEventListener('load', this.onLoad);
    }
  }

  detach() {
    this.token = null;
    if (this.onLoad && this.source) this.source.removeEventListener('load', this.onLoad);
    this.onLoad = null;
  }

  frame(ms) {
    const el = this.source;
    const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
    if (!sw || !sh) return;
    const outW = Math.min(OUT_W, sw), outH = Math.round(outW * sh / sw);
    const smallH = Math.max(1, Math.round(SMALL_W * sh / sw)), midH = smallH * BLOCK;
    if (this.canvas.width !== outW || this.canvas.height !== outH || this.smallH !== smallH) {
      this.canvas.width = outW; this.canvas.height = outH; this.smallH = smallH;
      this.mid.width = MID_W; this.mid.height = midH;
      this.delta.width = SMALL_W; this.delta.height = smallH;
      this.deltaImg = this.deltaCtx.createImageData(SMALL_W, smallH);
      this.px = new Float32Array(SMALL_W * smallH * 3);
      this.reset();
    }

    // Frame rate, for the filter coefficients. A long gap (a hidden tab) restarts.
    const dt = this.lastMs ? (ms - this.lastMs) / 1000 : 0;
    this.lastMs = ms;
    if (dt > 0.5) this.reset();
    if (dt > 0.005 && dt <= 0.5) this.fs = this.fs ? 0.9 * this.fs + 0.1 / dt : 1 / dt;

    // Blur: draw 320 pixels wide (the camera noise there still dithers the
    // 8-bit rounding), then average 8 x 8 blocks in floating point.
    this.midCtx.imageSmoothingEnabled = true; this.midCtx.imageSmoothingQuality = 'high';
    this.midCtx.drawImage(el, 0, 0, MID_W, midH);
    const mid = this.midCtx.getImageData(0, 0, MID_W, midH).data, px = this.px.fill(0);
    for (let y = 0; y < midH; y++) {
      const row = ((y / BLOCK) | 0) * SMALL_W;
      for (let x = 0; x < MID_W; x++) {
        const m = (y * MID_W + x) * 4, p = (row + ((x / BLOCK) | 0)) * 3;
        px[p] += mid[m]; px[p + 1] += mid[m + 1]; px[p + 2] += mid[m + 2];
      }
    }
    for (let i = 0; i < px.length; i++) px[i] /= BLOCK * BLOCK;

    this.ctx.drawImage(el, 0, 0, outW, outH);
    if (this.n === 0) {
      // Filters start from this frame's colour, so there is no start-up jolt.
      this.x0 = Float32Array.from(px);
      this.state = new Float32Array(px.length * 4);
      this.startMs = ms;
    }
    this.n++;
    if (this.fs < 5) return;                       // not enough frames yet to know the rate
    if (Math.abs(this.fs - this.coeffFs) > 0.1 * this.fs) this.design(this.fs);

    const gain = this.strength * Math.min(1, (ms - this.startMs) / 1000 / RAMP_S);
    const [hb0, hb1, hb2, ha1, ha2] = this.hp, [lb0, lb1, lb2, la1, la2] = this.lp;
    const s = this.state, x0 = this.x0, out = this.deltaImg.data;
    for (let i = 0; i < px.length; i++) {
      const x = px[i] - x0[i], k = i * 4;
      // Two biquads in transposed direct form II: high-pass, then low-pass.
      const h = hb0 * x + s[k];
      s[k] = hb1 * x - ha1 * h + s[k + 1];
      s[k + 1] = hb2 * x - ha2 * h;
      const y = lb0 * h + s[k + 2];
      s[k + 2] = lb1 * h - la1 * y + s[k + 3];
      s[k + 3] = lb2 * h - la2 * y;
      out[i + ((i / 3) | 0)] = 128 + Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, gain * y));   // RGB into RGBA
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    this.deltaCtx.putImageData(this.deltaImg, 0, 0);
    // Overlay with mid-grey changes nothing; lighter or darker grey brightens
    // or darkens the video by about twice its own amount (for mid tones).
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'overlay';
    this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.delta, 0, 0, outW, outH);
    this.ctx.restore();
  }

  // Butterworth (Q = 1/sqrt 2) biquads from the RBJ audio-EQ cookbook.
  design(fs) {
    this.coeffFs = fs;
    const biquad = (f, high) => {
      const w = 2 * Math.PI * Math.min(f, 0.45 * fs) / fs, c = Math.cos(w), a = Math.sin(w) / Math.SQRT2;
      const b = high ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
      const a0 = 1 + a;
      return [b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - a) / a0];
    };
    this.hp = biquad(BAND[0], true);
    this.lp = biquad(BAND[1], false);
  }
}
