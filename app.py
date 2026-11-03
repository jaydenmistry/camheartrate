"""FastAPI server: serves the dashboard and streams frames + telemetry over /ws.

Run:  uvicorn app:app --reload          then open http://localhost:8000

Environment:
    RPPG_SOURCE   camera (default) | synthetic | browser
                  camera/synthetic: this machine's camera (or the simulation) feeds
                  one shared measurement. browser: every visitor's page uses its own
                  camera and gets its own measurement (rppg_session.py); for deployment.
    RPPG_CAMERA   camera name or id to start with (default: the built-in camera)
    RPPG_MAX_SESSIONS   browser mode: most visitors measured at once, per worker (default 200)
    RPPG_PRESENTER_KEY  browser mode: a page opened with ?presenter=<key> gets the demo
                        keys and the simulation; with no key set, nobody does
    RPPG_CSP_REPORT_ONLY  1: send the Content-Security-Policy as report-only, so a
                          violation shows in the browser console instead of being blocked
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import Body, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import rppg_class
from rppg_session import BrowserSession

if TYPE_CHECKING:
    from rppg_pipeline import Pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("rppg.app")

STATIC_DIR = Path(__file__).resolve().parent / "static"
VENDOR_FILES = ("mediapipe/vision_bundle.mjs", "mediapipe/wasm/vision_wasm_internal.wasm",
                "mediapipe/face_landmarker.task", "mediapipe/hand_landmarker.task")
SEND_INTERVAL = 1.0 / 40.0       # poll faster than the 30 FPS source; only new frames are sent
SOURCE = os.environ.get("RPPG_SOURCE", "camera").lower()
BROWSER = SOURCE == "browser"
MAX_SESSIONS = int(os.environ.get("RPPG_MAX_SESSIONS", "200"))
PRESENTER_KEY = os.environ.get("RPPG_PRESENTER_KEY", "")
LOCAL_ASSETS = all((STATIC_DIR / "vendor" / f).exists() for f in VENDOR_FILES)    # see fetch_assets.py
CSP_REPORT_ONLY = os.environ.get("RPPG_CSP_REPORT_ONLY", "") == "1"


def inline_script_hashes() -> list[str]:
    """CSP hashes of the pages' inline <script> blocks, so no other inline script runs."""
    hashes = []
    for page in ("index.html", "class.html"):
        for body in re.findall(r"<script>(.*?)</script>", (STATIC_DIR / page).read_text("utf-8"), re.S):
            digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
            hashes.append(f"'sha256-{digest}'")
    return hashes


def content_security_policy() -> str:
    # Without the files from fetch_assets.py the page falls back to these CDNs.
    cdn_scripts = "" if LOCAL_ASSETS else " https://cdn.jsdelivr.net https://cdnjs.cloudflare.com"
    cdn_fetches = "" if LOCAL_ASSETS else " https://cdn.jsdelivr.net https://storage.googleapis.com"
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' 'wasm-unsafe-eval' {' '.join(inline_script_hashes())}{cdn_scripts}",  # MediaPipe is WebAssembly
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",              # data: the QR code; blob: server-mode frames
        f"connect-src 'self'{cdn_fetches}",        # 'self' includes the page's own ws:// and wss://
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


SECURITY_HEADERS = {
    "Content-Security-Policy-Report-Only" if CSP_REPORT_ONLY else "Content-Security-Policy":
        content_security_policy(),
    "Strict-Transport-Security": "max-age=31536000",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "same-origin",          # keeps ?presenter=<key> out of other sites' Referer
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.sessions = 0
    if BROWSER:
        log.info("ready at http://localhost:8000 (each browser uses its own camera)")
        if not PRESENTER_KEY:
            log.info("simulation off: set RPPG_PRESENTER_KEY, then open the page with ?presenter=<key>")
        writer = asyncio.create_task(rppg_class.keep_writing())
        try:
            yield
        finally:
            writer.cancel()
            rppg_class.remove_file()
        return
    from rppg_pipeline import Pipeline     # needs MediaPipe and camera access; not in browser mode

    # Built on the event loop's (main) thread so a first-run macOS camera
    # permission prompt can appear.
    pipeline = Pipeline(source=SOURCE, camera_id=os.environ.get("RPPG_CAMERA") or None)
    pipeline.start()
    app.state.pipeline = pipeline
    log.info("dashboard ready at http://localhost:8000 (source: %s)", pipeline.source)
    retry = asyncio.create_task(retry_camera(pipeline))
    try:
        yield
    finally:
        retry.cancel()
        pipeline.stop()


async def retry_camera(pipeline: Pipeline) -> None:
    """On first run macOS answers 'not determined' while its permission prompt
    is up. Keep trying (on this main thread) so the camera starts once allowed."""
    while True:
        await asyncio.sleep(2.0)
        if pipeline.wants_camera and pipeline.source != "camera":
            pipeline.set_source("camera")


app = FastAPI(title="rPPG Heart Rate Monitor", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/class")
async def class_view() -> FileResponse:
    """Projector page: how many are connected and everyone's heart rate."""
    return FileResponse(STATIC_DIR / "class.html", headers={"Cache-Control": "no-cache"})


@app.get("/api/class")
async def class_data() -> JSONResponse:
    if BROWSER:
        return JSONResponse(rppg_class.snapshot())
    _, _, tele = app.state.pipeline.latest()        # local: the one measurement on this machine
    entry = {"source": tele.get("source"), "status": tele.get("status"), "bpm": tele.get("bpm"),
             "measuring": (tele.get("buffer_s") or 0) > 0, "t": time.time()}
    return JSONResponse(rppg_class.summarise([entry], time.time()))


@app.post("/api/class/reset")
async def class_reset(key: str = Body("", embed=True)) -> JSONResponse:
    """Presenter only: clear everyone's pulse checks, e.g. after a rehearsal."""
    if not (BROWSER and is_presenter(key)):
        return JSONResponse({"ok": False}, status_code=403)
    rppg_class.reset()
    return JSONResponse({"ok": True})


def is_presenter(key: str) -> bool:
    return bool(PRESENTER_KEY) and secrets.compare_digest(key.encode(), PRESENTER_KEY.encode())


@app.get("/api/config")
async def config() -> JSONResponse:
    """Tells the page whether it measures its own camera (browser) or shows this machine's (server)."""
    return JSONResponse({"mode": "browser" if BROWSER else "server", "local_assets": LOCAL_ASSETS})


@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"ok": True})


@app.get("/api/telemetry")
async def telemetry() -> JSONResponse:
    """Latest telemetry snapshot (handy for debugging without the UI)."""
    if BROWSER:
        return JSONResponse({"mode": "browser", "sessions": app.state.sessions})
    _, _, tele = app.state.pipeline.latest()
    return JSONResponse(tele)


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    """Server -> client: binary JPEG frame, then a JSON telemetry text message.
    Client -> server: JSON commands, e.g. {"type": "algorithm", "value": "CHROM"}.
    In browser mode each connection is its own measurement; see rppg_session.py."""
    await websocket.accept()
    if BROWSER:
        if app.state.sessions >= MAX_SESSIONS:
            await websocket.close(code=1013, reason="server full")
            return
        presenter = is_presenter(websocket.query_params.get("presenter", ""))
        app.state.sessions += 1
        try:
            await BrowserSession(websocket, presenter=presenter).run()
        finally:
            app.state.sessions -= 1
        return
    pipeline: Pipeline = websocket.app.state.pipeline

    async def receive_commands() -> None:
        while True:
            msg = await websocket.receive_json()
            try:
                pipeline.handle_command(msg)
            except (KeyError, ValueError) as exc:
                log.warning("bad command %r: %s", msg, exc)

    receiver = asyncio.create_task(receive_commands())
    last_seq = -1
    try:
        while not receiver.done():
            seq, jpeg, tele = pipeline.latest()
            if seq != last_seq:
                last_seq = seq
                if jpeg is not None:
                    await websocket.send_bytes(jpeg)
                await websocket.send_text(json.dumps(tele))
            await asyncio.sleep(SEND_INTERVAL)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        receiver.cancel()
