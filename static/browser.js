// The visitor's own camera, for the deployed app (RPPG_SOURCE=browser).
//
// The page measures itself: MediaPipe finds the face and hand, and on every
// video frame the mean colour of each skin patch (forehead and both cheeks, or
// the palm) goes to the server, which runs the rPPG DSP (rppg_session.py).
// Video never leaves the browser. This follows rppg_vision.py, rppg_regions.py
// and rppg_pipeline.py; arbitrary skin blobs (an arm) are not tracked here.

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const FOREHEAD = [10, 338, 297, 332, 299, 337, 151, 108, 69, 103, 67, 109];
const LEFT_MALAR = [117, 118, 101, 36, 205, 187, 123];
const RIGHT_MALAR = [346, 347, 330, 266, 425, 411, 352];
const PALM = [0, 1, 5, 9, 13, 17];          // wrist, thumb base, the four knuckles

// Tracking is the heavy part and runs on the page's main thread, where it can
// delay frames. The skin is still measured on every frame; the outline only
// needs to keep up with a person sitting still. Looking for a hand that is not
// there (MediaPipe's palm detector) is the most expensive step, so it is rare.
const TRACK_HZ = 15;
const HAND_SEARCH_HZ = 4;
const SETTLE_MS = 2000;         // auto exposure / white balance settle this long before they are held
const SEND_EVERY_MS = 100;
const MIN_PATCH_PIXELS = 150;
const CLIP_LEVEL = 250;         // a channel at or above this is saturated: no pulse left in it
const SWITCH_S = 1.0;           // an automatic switch must persist this long
const HOLD_S = 0.6;             // ride through short detection dropouts
const LOCK_TIMEOUT_S = 2.0;     // a tapped region that disappears this long is released

// ------------------------------------------------------------- geometry

function hull(points) {
  // Andrew's monotone chain; points are [x, y].
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function insideConvex(poly, x, y) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (c && sign && c !== sign) return false;
    sign = sign || c;
  }
  return true;
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p[0]; y += p[1]; }
  return [x / points.length, y / points.length];
}

// Scanline fill of a convex polygon into a label image (pixel centres inside).
function fillConvex(labels, w, h, poly, x0, y0, value) {
  const ys = poly.map(p => p[1] - y0);
  const top = Math.max(0, Math.floor(Math.min(...ys))), bottom = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = top; y <= bottom; y++) {
    const yc = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const ax = poly[i][0] - x0, ay = poly[i][1] - y0;
      const b = poly[(i + 1) % poly.length], bx = b[0] - x0, by = b[1] - y0;
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        const x = ax + (yc - ay) / (by - ay) * (bx - ax);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
    }
    if (lo > hi) continue;
    const from = Math.max(0, Math.ceil(lo - 0.5)), to = Math.min(w - 1, Math.floor(hi - 0.5));
    labels.fill(value, y * w + from, y * w + to + 1);
  }
}

// ------------------------------------------------------------- landmarks

// One Euro filter (Casiez et al., 2012) over a flat [x0, y0, x1, y1, ...] array:
// smooths hard while still, lets go while moving, so the outline neither shakes nor lags.
class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.015, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: null, t: 0 });
  }
  static alpha(cutoff, dt) { return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt)); }
  filter(x, t) {
    if (!x) return null;
    const dt = t - this.t;
    if (!this.x || x.length !== this.x.length || !(dt > 0 && dt < 0.5)) {
      this.x = Float32Array.from(x); this.dx = new Float32Array(x.length); this.t = t;
      return this.x;
    }
    const ad = OneEuro.alpha(this.dCutoff, dt);
    for (let i = 0; i < x.length; i++) {
      this.dx[i] += ad * ((x[i] - this.x[i]) / dt - this.dx[i]);
      this.x[i] += OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx[i]), dt) * (x[i] - this.x[i]);
    }
    this.t = t;
    return this.x;
  }
}

function toPixels(landmarks, w, h) {
  const out = new Float32Array(landmarks.length * 2);
  landmarks.forEach((p, i) => { out[2 * i] = p.x * w; out[2 * i + 1] = p.y * h; });
  return out;
}

const point = (lm, i) => [lm[2 * i], lm[2 * i + 1]];

function faceRegion(lm) {
  const mesh = Array.from({ length: 468 }, (_, i) => point(lm, i));
  return {
    kind: 'face',
    outline: [FOREHEAD, LEFT_MALAR, RIGHT_MALAR].map(idx => hull(idx.map(i => point(lm, i)))),
    hit: hull(mesh), centre: centroid(mesh),
  };
}

function palmRegion(lm) {
  const pts = PALM.map(i => point(lm, i));
  const [cx, cy] = centroid(pts);
  const shrunk = pts.map(([x, y]) => [cx + 0.85 * (x - cx), cy + 0.85 * (y - cy)]);   // clear of the edges
  const all = Array.from({ length: lm.length / 2 }, (_, i) => point(lm, i));
  return { kind: 'palm', outline: [hull(shrunk)], hit: hull(all), centre: [cx, cy] };
}

// ------------------------------------------------------------- region choice

// Palm first, then face; tapping locks onto one. A change restarts the
// measurement, so automatic switches must persist and dropouts are ridden out.
class RegionSelector {
  constructor(notify) {
    this.notify = notify;
    this.current = null; this.locked = false; this.lastSeen = -Infinity;
    this.pending = null; this.pendingSince = 0; this.tapAt = null;
  }
  tap(x, y) { this.tapAt = [x, y]; }
  release() {
    if (this.locked) { this.locked = false; this.notify('Choosing skin automatically'); }
  }
  update(cands, t) {
    let changed = false;
    if (this.tapAt) {
      const [x, y] = this.tapAt;
      this.tapAt = null;
      const hit = ['palm', 'face'].map(k => cands[k]).find(r => r && insideConvex(r.hit, x, y));
      if (hit) {
        changed = !this.current || this.current.kind !== hit.kind;
        Object.assign(this, { current: hit, lastSeen: t, locked: true });
        this.notify(hit.kind === 'palm' ? 'Reading your palm' : 'Reading your face');
      } else {
        this.locked = false;
        this.notify('Tap your face or palm. Choosing automatically');
      }
    }
    if (this.locked) {
      const again = cands[this.current.kind];
      if (again) { this.current = again; this.lastSeen = t; return { region: again, changed }; }
      if (t - this.lastSeen <= LOCK_TIMEOUT_S) return { region: null, changed };
      this.locked = false;
      this.notify('Lost the skin you picked. Choosing automatically');
    }
    const best = cands.palm || cands.face;
    if (!best) {
      if (this.current && t - this.lastSeen > HOLD_S) { this.current = null; changed = true; }
      return { region: null, changed };
    }
    if (!this.current || best.kind === this.current.kind) {
      changed = changed || !this.current;
      Object.assign(this, { current: best, lastSeen: t, pending: null });
      return { region: best, changed };
    }
    // A different region wins this frame: switch only if it persists.
    if (this.pending !== best.kind) { this.pending = best.kind; this.pendingSince = t; }
    const still = cands[this.current.kind];
    if (t - this.pendingSince >= SWITCH_S || (!still && t - this.lastSeen > HOLD_S)) {
      Object.assign(this, { current: best, lastSeen: t, pending: null });
      if (best.kind === 'palm') this.notify('Reading your palm');
      return { region: best, changed: true };
    }
    if (still) { this.current = still; this.lastSeen = t; return { region: still, changed }; }
    return { region: null, changed };
  }
}

// ------------------------------------------------------------- camera

function cameraError(e) {
  switch (e && e.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site (the camera icon in the address bar), then reload.';
    case 'NotFoundError': case 'OverconstrainedError':
      return 'No camera found on this device.';
    case 'NotReadableError': case 'AbortError':
      return 'The camera is in use by another app. Close it, then reload.';
    default:
      return `Camera unavailable: ${(e && e.message) || e}.`;
  }
}

export class BrowserCamera {
  constructor(video, { send, onChange, onNotice }) {
    Object.assign(this, { video, send, onChange, onNotice });
    this.state = 'idle';            // idle | camera | failed
    this.ready = false;             // tracking models loaded
    this.active = true;             // false while the simulation runs
    this.message = '';
    this.loading = 'Starting the camera…';
    this.mode = null;
    this.held = false;              // exposure / white balance held fixed
    this.cameras = [];
    this.gen = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.resetTracking();
  }

  resetTracking() {
    this.selector = new RegionSelector((text) => this.onNotice(text));
    this.faceSmooth = new OneEuro();
    this.handSmooth = new OneEuro();
    this.handLm = null;
    this.roi = null;
    this.shown = null;
    this.clipped = 0;
    this.brightness = null;
    this.motion = 0;
    this.lastCentre = null;
    this.batch = [];
    this.lastFlush = 0;
    this.lastTrack = -Infinity;
    this.lastHandSearch = -Infinity;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.fail(window.isSecureContext ? 'This browser cannot use a camera.'
        : 'The camera needs a secure connection. Open this page over https.');
      return;
    }
    const models = this.loadModels();       // in parallel with the permission prompt
    models.catch(() => {});
    if (!await this.openCamera()) return;
    this.loading = 'Loading face and hand tracking…';
    this.onChange();
    try {
      await models;
    } catch (e) {
      console.error(e);
      this.fail(`Could not load the tracking models: ${(e && e.message) || e}.`);
      return;
    }
    this.ready = true;
    this.loading = '';
    this.onChange();
    this.restartLoop();
  }

  async loadModels() {
    const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = async (Kind, opts) => {
      try {
        return await Kind.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } });
      } catch (e) {
        return Kind.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } });
      }
    };
    [this.face, this.hand] = await Promise.all([
      make(FaceLandmarker, { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 }),
      make(HandLandmarker, { baseOptions: { modelAssetPath: HAND_MODEL }, runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }),
    ]);
    this.lastTs = 0;
  }

  async openCamera(deviceId) {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = 'user';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      this.fail(cameraError(e));
      return false;
    }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    const fps = Math.min(60, Math.max(10, Math.round((s.frameRate || 30) * 10) / 10));
    this.fs = fps;
    this.mode = { id: s.deviceId || '', name: track.label || 'Camera',
                  width: this.video.videoWidth, height: this.video.videoHeight, fps };
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameras = devices.filter(d => d.kind === 'videoinput' && d.deviceId)
        .map((d, i) => ({ id: d.deviceId, name: d.label || `Camera ${i + 1}` }));
    } catch (e) { this.cameras = []; }
    this.state = 'camera';
    this.message = '';
    this.flush();
    this.gen += 1;
    this.resetTracking();
    if (this.ready) this.restartLoop();         // frame callbacks belong to the old stream
    this.onChange();
    this.settle();
    return true;
  }

  // Let auto exposure and white balance settle under the current light, then
  // hold them, so the camera stops repainting the skin it is measuring. Only
  // where the camera allows it (mostly Chrome on Windows, Linux and Android);
  // elsewhere POS's per-window normalisation has to absorb the adjustments.
  async settle() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    const can = (key) => (caps[key] || []).includes('manual') && (caps[key] || []).includes('continuous');
    const keys = ['exposureMode', 'whiteBalanceMode'].filter(can);
    this.held = false;
    if (!keys.length) return;
    const token = this.settling = (this.settling || 0) + 1;
    try {
      await track.applyConstraints({ advanced: [Object.fromEntries(keys.map(k => [k, 'continuous']))] });
    } catch (e) { return; }
    this.onChange();
    await new Promise(r => setTimeout(r, SETTLE_MS));
    if (token !== this.settling || track.readyState !== 'live') return;    // superseded or switched
    const now = track.getSettings(), hold = Object.fromEntries(keys.map(k => [k, 'manual']));
    if (hold.exposureMode && now.exposureTime) hold.exposureTime = now.exposureTime;
    if (hold.whiteBalanceMode && now.colorTemperature) hold.colorTemperature = now.colorTemperature;
    try {
      await track.applyConstraints({ advanced: [hold] });
      this.held = true;
    } catch (e) {
      console.warn('could not hold the camera settings', e);
    }
    this.flush();
    this.gen += 1;                              // the picture just changed: start the measurement over
    this.onChange();
  }

  async switchTo(deviceId) {
    if (deviceId && deviceId !== (this.mode && this.mode.id)) await this.openCamera(deviceId);
  }

  fail(message) {
    this.state = 'failed';
    this.message = message;
    this.loading = '';
    this.onChange();
  }

  setActive(on) {
    if (on && !this.active) { this.gen += 1; this.batch = []; }
    this.active = on;
  }

  tap(x, y) {            // 0-1 coordinates in the unmirrored frame
    this.selector.tap(x * this.video.videoWidth, y * this.video.videoHeight);
  }

  release() { this.selector.release(); }

  // ----------------------------------------------------------- per frame

  restartLoop() {
    this.loop = (this.loop || 0) + 1;           // an older loop sees a stale token and stops
    this.schedule(this.loop);
  }

  schedule(loop) {
    if (this.video.requestVideoFrameCallback) {
      this.video.requestVideoFrameCallback((now, meta) =>
        this.onFrame(loop, meta.captureTime || meta.expectedDisplayTime || now));
    } else {
      requestAnimationFrame((now) => {          // no frame callbacks: sample each new frame once
        const vt = this.video.currentTime;
        if (vt === this.lastVideoTime) { this.schedule(loop); return; }
        this.lastVideoTime = vt;
        this.onFrame(loop, now);
      });
    }
  }

  onFrame(loop, ms) {
    if (loop !== this.loop) return;
    try {
      if (this.state === 'camera' && this.video.videoWidth) {
        this.measure(ms / 1000);
        if (ms - this.lastTrack >= 1000 / TRACK_HZ - 2) { this.lastTrack = ms; this.track(ms); }
      }
    } catch (e) {
      console.error(e);
    }
    this.schedule(loop);
  }

  // Average each skin patch in this frame, using the mask from the last tracking pass.
  measure(t) {
    const roi = this.roi;
    if (!roi || !this.active) return;
    const { x0, y0, w, h, labels, patches } = roi;
    if (x0 + w > this.video.videoWidth || y0 + h > this.video.videoHeight) return;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.drawImage(this.video, x0, y0, w, h, 0, 0, w, h);
    const px = this.ctx.getImageData(0, 0, w, h).data;
    const sums = new Float64Array(patches * 3), counts = new Uint32Array(patches);
    for (let i = 0, j = 0; i < labels.length; i++, j += 4) {
      const l = labels[i];
      if (!l) continue;
      const r = px[j], g = px[j + 1], b = px[j + 2];
      if (r >= CLIP_LEVEL || g >= CLIP_LEVEL || b >= CLIP_LEVEL) continue;
      const k = (l - 1) * 3;
      sums[k] += r; sums[k + 1] += g; sums[k + 2] += b;
      counts[l - 1]++;
    }
    let total = 0, luma = 0;
    for (let p = 0; p < patches; p++) {
      total += counts[p];
      luma += 0.299 * sums[p * 3] + 0.587 * sums[p * 3 + 1] + 0.114 * sums[p * 3 + 2];
    }
    this.clipped = 1 - total / Math.max(roi.pixels, 1);
    this.brightness = total ? luma / total : null;
    if (counts.some(c => c < MIN_PATCH_PIXELS)) return;
    const row = [Math.round(t * 1e4) / 1e4];
    for (let p = 0; p < patches; p++) {
      for (let c = 0; c < 3; c++) row.push(Math.round(sums[p * 3 + c] / counts[p] * 1e4) / 1e4);
    }
    this.batch.push(row);
    if (t * 1000 - this.lastFlush >= SEND_EVERY_MS) { this.lastFlush = t * 1000; this.flush(); }
  }

  flush() {
    if (this.batch.length && this.active) {
      this.send({ type: 'samples', gen: this.gen, fs: this.fs, samples: this.batch });
    }
    this.batch = [];
  }

  // Landmarks, region choice and the next mask.
  track(ms) {
    if (!this.ready) return;
    const t = ms / 1000, w = this.video.videoWidth, h = this.video.videoHeight;
    const ts = Math.max(Math.round(ms), this.lastTs + 1);       // must strictly increase
    this.lastTs = ts;
    const face = this.face.detectForVideo(this.video, ts);
    const faceLm = this.faceSmooth.filter(face.faceLandmarks && face.faceLandmarks[0]
      ? toPixels(face.faceLandmarks[0], w, h) : null, t);
    if (this.handLm || ms - this.lastHandSearch >= 1000 / HAND_SEARCH_HZ) {
      this.lastHandSearch = ms;
      const hand = this.hand.detectForVideo(this.video, ts);
      this.handLm = this.handSmooth.filter(hand.landmarks && hand.landmarks[0]
        ? toPixels(hand.landmarks[0], w, h) : null, t);
    }
    const cands = {};
    if (faceLm) cands.face = faceRegion(faceLm);
    if (this.handLm) cands.palm = palmRegion(this.handLm);

    const { region, changed } = this.selector.update(cands, t);
    if (changed) { this.flush(); this.gen += 1; }
    if (region) this.roi = this.buildRoi(region, w, h);
    else if (!this.selector.current) this.roi = null;

    const shown = region || this.selector.current;
    if (shown && this.lastCentre && t > this.lastCentre[2]) {
      const speed = Math.hypot(shown.centre[0] - this.lastCentre[0], shown.centre[1] - this.lastCentre[1])
        / (t - this.lastCentre[2]) / w;
      this.motion += 0.3 * (speed - this.motion);
    }
    this.lastCentre = shown ? [shown.centre[0], shown.centre[1], t] : null;
    this.shown = shown;
    this.onChange();
  }

  buildRoi(region, w, h) {
    const pts = region.outline.flat();
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))));
    const x1 = Math.min(w, Math.ceil(Math.max(...pts.map(p => p[0]))) + 1);
    const y1 = Math.min(h, Math.ceil(Math.max(...pts.map(p => p[1]))) + 1);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    const rw = x1 - x0, rh = y1 - y0;
    const labels = new Uint8Array(rw * rh);
    region.outline.forEach((poly, i) => fillConvex(labels, rw, rh, poly, x0, y0, i + 1));
    let pixels = 0;
    for (const l of labels) if (l) pixels++;
    return { x0, y0, w: rw, h: rh, labels, patches: region.outline.length, pixels };
  }

  // Fields the page merges over the server's telemetry.
  telemetry() {
    const tele = { source: this.state === 'camera' && this.ready ? 'camera' : 'idle',
                   message: this.message, loading: this.loading, cameras: this.cameras,
                   camera: this.mode && { ...this.mode, held: this.held } };
    if (this.state !== 'camera') return tele;
    const w = this.video.videoWidth || 16, h = this.video.videoHeight || 9;
    const s = this.shown;
    Object.assign(tele, {
      frame: [w, h],
      region: s ? { kind: s.kind, locked: this.selector.locked,
                    outline: s.outline.map(poly => poly.map(([x, y]) => [1 - x / w, y / h])) } : null,
      clipped: Math.round(this.clipped * 1000) / 1000,
      brightness: this.brightness === null ? null : Math.round(this.brightness),
      moving: this.motion > 0.05,
      roi_pixels: this.roi ? this.roi.pixels : 0,
    });
    if (this.ready && !s) tele.status = 'NO SKIN';
    return tele;
  }
}
