"""One visitor's measurement when the app is deployed (RPPG_SOURCE=browser).

Each visitor's page opens their own camera, finds the skin with MediaPipe and
averages it (static/browser.js), then sends only the mean colour of each skin
patch, about 30 rows a second. Video never leaves the browser, and no JPEG
compression touches the colour signal. The server keeps one RPPGEngine per
connection and answers with telemetry.

Client -> server (JSON):
  {"type": "samples", "gen": 3, "fs": 30, "samples": [[t, r, g, b, r, g, b, ...], ...]}
      t in seconds on the browser's clock, one (r, g, b) per skin patch.
      A new `gen` means a new skin region: the measurement restarts.
  {"type": "algorithm", "value": "CHROM"}
  {"type": "source", "value": "synthetic" | "camera"}     simulation: presenter only
  {"type": "synthetic", "bpm": 90, "motion": 0.5}
  {"type": "reset"}
  {"type": "check", "tapped": 74, "camera": 72}       pulse check result, for the class view
Server -> client: JSON telemetry; in the simulation also a binary JPEG per frame.

The DSP and the simulation's rendering run in worker threads, so one busy
visitor does not hold up the event loop that serves everyone else.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time

import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

import rppg_class
from rppg_dsp import RPPGEngine
from rppg_synthetic import SyntheticRenderer, SyntheticSkinTrace, roi_pixel_count

log = logging.getLogger("rppg.session")

SYNTH_FPS = 30.0
JPEG_QUALITY = 80
MAX_PATCHES = 4
MAX_ROWS = 120              # rows per message (4 s at 30 fps)
FS_RANGE = (10.0, 60.0)     # sampling rates a browser may ask for
BPM_RANGE = (30.0, 220.0)   # plausible rates in a pulse check


class BrowserSession:
    def __init__(self, websocket: WebSocket, presenter: bool = False):
        self.ws = websocket
        self.presenter = presenter          # may run the simulation (it streams video, so it costs more)
        self.source = "camera"
        self.engine = RPPGEngine()
        self.gen: int | None = None
        self.synth = SyntheticSkinTrace(bpm=72.0, motion=0.3)
        self.renderer = SyntheticRenderer()
        self.synth_pixels = roi_pixel_count()
        self._send_lock = asyncio.Lock()
        self._dsp = asyncio.Lock()          # one engine operation at a time
        self._synth_task: asyncio.Task | None = None
        self._class_id = rppg_class.register()

    async def run(self) -> None:
        try:
            await self._send_text(self._telemetry())
            while True:
                msg = await self.ws.receive_json()
                try:
                    await self._handle(msg)
                except (KeyError, ValueError, TypeError) as exc:
                    log.debug("bad message %.200r: %s", msg, exc)
        except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
            pass
        finally:
            self._stop_synthetic()
            rppg_class.unregister(self._class_id)

    # -- messages ----------------------------------------------------------------

    async def _handle(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "samples":
            if self.source != "camera":
                return
            async with self._dsp:
                self._add_samples(msg)
                await asyncio.to_thread(self.engine.update)
        elif kind == "algorithm":
            async with self._dsp:
                self.engine.set_algorithm(str(msg["value"]))
        elif kind == "source":
            async with self._dsp:
                self._set_source(str(msg["value"]))
        elif kind == "synthetic":
            self.synth.set_params(bpm=_number(msg.get("bpm")), motion=_number(msg.get("motion")))
        elif kind == "reset":
            async with self._dsp:
                self.engine.reset()
        elif kind == "check":
            tapped, camera = _number(msg["tapped"]), _number(msg["camera"])
            if not all(BPM_RANGE[0] <= x <= BPM_RANGE[1] for x in (tapped, camera)):
                raise ValueError("check out of range")
            rppg_class.update(self._class_id, check={"tapped": round(tapped, 1), "camera": round(camera, 1)})
            return
        else:
            return
        if self.source == "camera":
            await self._send_text(self._telemetry())

    def _add_samples(self, msg: dict) -> None:
        gen, fs = int(msg["gen"]), float(msg["fs"])
        if not FS_RANGE[0] <= fs <= FS_RANGE[1]:
            raise ValueError(f"fs {fs} out of range")
        rows = msg["samples"]
        if not isinstance(rows, list) or not 0 < len(rows) <= MAX_ROWS:
            raise ValueError("bad sample count")
        data = np.asarray(rows, dtype=float)
        if (data.ndim != 2 or not 4 <= data.shape[1] <= 1 + 3 * MAX_PATCHES
                or (data.shape[1] - 1) % 3 or not np.isfinite(data).all()):
            raise ValueError(f"bad sample shape {data.shape}")
        if gen != self.gen or fs != self.engine.fs:     # new region or camera: start over
            self.gen = gen
            self.engine = RPPGEngine(algorithm=self.engine.algorithm, fs=fs)
        for row in data:
            self.engine.add_patches(float(row[0]), row[1:].reshape(-1, 3))

    def _set_source(self, source: str) -> None:
        if source == self.source:
            return
        if source == "synthetic":
            if not self.presenter:
                raise ValueError("the simulation is for the presenter")
            self.source = "synthetic"
            self.engine = RPPGEngine(algorithm=self.engine.algorithm, fs=SYNTH_FPS)
            self._synth_task = asyncio.create_task(self._synthetic_loop())
        elif source == "camera":
            self._stop_synthetic()
            self.source = "camera"
            self.engine = RPPGEngine(algorithm=self.engine.algorithm)
            self.gen = None                     # the next samples set the camera's rate
        else:
            raise ValueError(f"unknown source {source!r}")

    # -- simulation ----------------------------------------------------------------

    async def _synthetic_loop(self) -> None:
        # ~30 FPS with webcam-like jitter and occasional dropped frames, so the
        # resampling stage sees realistic irregular timestamps.
        rng = np.random.default_rng()
        next_t = time.perf_counter()
        try:
            while self.source == "synthetic":
                delay = next_t - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)
                elif delay < -0.5:
                    next_t = time.perf_counter()
                t = time.perf_counter()
                step = 1.0 / SYNTH_FPS + rng.normal(0.0, 0.002)
                if rng.random() < 0.02:
                    step += 1.0 / SYNTH_FPS
                next_t += step

                async with self._dsp:
                    if self.source != "synthetic":
                        break
                    jpeg, tele = await asyncio.to_thread(self._synthetic_frame, t)
                if jpeg is not None:
                    await self._send_bytes(jpeg)
                await self._send_text(tele)
        except (WebSocketDisconnect, RuntimeError):
            pass

    def _synthetic_frame(self, t: float) -> tuple[bytes | None, dict]:
        rgb = self.synth.sample(t)
        self.engine.add_sample(t, *rgb)
        self.engine.update(t)
        frame, outline = self.renderer.render(rgb, self.synth.last_motion)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        tele = self._telemetry()
        h, w = frame.shape[:2]
        tele.update({"synthetic": self.synth.truth, "frame": [w, h], "roi_pixels": self.synth_pixels,
                     "noise_reduction": round(math.sqrt(self.synth_pixels), 1),
                     "region": {"kind": "simulated", "locked": False, "outline": outline}})
        return (buf.tobytes() if ok else None), tele

    def _stop_synthetic(self) -> None:
        if self._synth_task is not None:
            self._synth_task.cancel()
            self._synth_task = None

    # -- output ----------------------------------------------------------------------

    def _telemetry(self) -> dict:
        tele = self.engine.telemetry(waveforms=False)
        tele["source"] = self.source
        tele["presenter"] = self.presenter
        rppg_class.update(self._class_id, source=self.source, status=tele["status"], bpm=tele["bpm"],
                          measuring=tele["buffer_s"] > 0)
        return tele

    async def _send_text(self, tele: dict) -> None:
        async with self._send_lock:
            await self.ws.send_text(json.dumps(tele))

    async def _send_bytes(self, data: bytes) -> None:
        async with self._send_lock:
            await self.ws.send_bytes(data)


def _number(value) -> float | None:
    if value is None:
        return None
    x = float(value)
    if not math.isfinite(x):
        raise ValueError("not a finite number")
    return x
