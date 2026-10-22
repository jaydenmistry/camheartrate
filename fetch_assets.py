"""Download the browser-side tracking files into static/vendor/, so the
deployed page loads everything from its own server.

The page needs MediaPipe Tasks Vision (JavaScript + WebAssembly), the face and
hand landmark models, and a QR code library for the class view. Without these
files it falls back to cdn.jsdelivr.net, storage.googleapis.com and cdnjs,
which a school or venue network may block. The Docker build runs this; run
it yourself to serve the files locally too:

    python fetch_assets.py

Every file is pinned to a SHA-256, so a changed upstream file fails the build
instead of being served.
"""

from __future__ import annotations

import hashlib
import sys
import urllib.error
import urllib.request
from pathlib import Path

VENDOR = Path(__file__).resolve().parent / "static" / "vendor"
MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"
MODELS = "https://storage.googleapis.com/mediapipe-models"

FILES = {   # local path: (url, sha256)
    "mediapipe/vision_bundle.mjs": (
        f"{MP}/vision_bundle.mjs",
        "e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669"),
    "mediapipe/wasm/vision_wasm_internal.js": (
        f"{MP}/wasm/vision_wasm_internal.js",
        "9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c"),
    "mediapipe/wasm/vision_wasm_internal.wasm": (
        f"{MP}/wasm/vision_wasm_internal.wasm",
        "f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc"),
    "mediapipe/wasm/vision_wasm_nosimd_internal.js": (
        f"{MP}/wasm/vision_wasm_nosimd_internal.js",
        "abe9b6fbeaf86fcb53a5edce3926c82ccb0619e18fed4d9d9ce561ee7f55e054"),
    "mediapipe/wasm/vision_wasm_nosimd_internal.wasm": (
        f"{MP}/wasm/vision_wasm_nosimd_internal.wasm",
        "38b61feab2fd7934e05cbe9f68baa308978a5e3b7f85c1913bb8ae89b8ef8b97"),
    "mediapipe/face_landmarker.task": (
        f"{MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"),
    "mediapipe/hand_landmarker.task": (
        f"{MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"),
    "qrcode.min.js": (
        "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
        "c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36"),
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    for rel, (url, digest) in FILES.items():
        path = VENDOR / rel
        if path.exists() and sha256(path) == digest:
            print(f"ok       {rel}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".part")
        print(f"fetching {rel}")
        try:
            urllib.request.urlretrieve(url, tmp)
        except urllib.error.URLError as exc:
            print(f"could not download {url}: {exc.reason}", file=sys.stderr)
            if "CERTIFICATE_VERIFY_FAILED" in str(exc.reason):
                print("this Python has no root certificates; on macOS run "
                      "'/Applications/Python 3.12/Install Certificates.command'", file=sys.stderr)
            return 1
        got = sha256(tmp)
        if got != digest:
            tmp.unlink()
            print(f"checksum mismatch for {rel}: expected {digest}, got {got}", file=sys.stderr)
            return 1
        tmp.replace(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
