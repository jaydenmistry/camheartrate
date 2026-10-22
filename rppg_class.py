"""The class view: what everyone connected is reading, pooled across workers.

Each worker process keeps its own visitors' latest readings in memory and
writes them to a small JSON file every second; /api/class reads every
worker's file. The files live in one directory (RPPG_CLASS_DIR, default
<tmp>/rppg-class), which all workers in one container share. Nothing
identifies anyone: one entry per connection with a reading and, after a
pulse check, the tapped and camera rates.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import os
import statistics
import tempfile
import time
from pathlib import Path

log = logging.getLogger("rppg.class")

CLASS_DIR = Path(os.environ.get("RPPG_CLASS_DIR") or Path(tempfile.gettempdir()) / "rppg-class")
WRITE_EVERY_S = 1.0
STALE_S = 5.0                   # a reading (or a worker's file) older than this no longer counts
KEEP_CHECKS = 500               # pulse checks of people who have left, per worker
READING_STATUSES = ("LOCKED", "WEAK SIGNAL")

_ids = itertools.count(1)
_entries: dict[int, dict] = {}
_past_checks: list[dict] = []   # a check stays in the class view after its page closes


def register() -> int:
    key = next(_ids)
    _entries[key] = {"t": time.time()}
    return key


def update(key: int, **fields) -> None:
    entry = _entries.get(key)
    if entry is not None:
        entry.update(fields, t=time.time())


def unregister(key: int) -> None:
    entry = _entries.pop(key, None)
    if entry and entry.get("check"):
        _past_checks.append({"check": entry["check"]})
        del _past_checks[:-KEEP_CHECKS]


def _path() -> Path:
    return CLASS_DIR / f"worker-{os.getpid()}.json"


def write() -> None:
    CLASS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _path().with_suffix(".tmp")
    tmp.write_text(json.dumps({"t": time.time(), "entries": list(_entries.values()) + _past_checks}))
    os.replace(tmp, _path())


async def keep_writing() -> None:
    while True:
        try:
            write()
        except OSError as exc:
            log.warning("could not write the class file: %s", exc)
        await asyncio.sleep(WRITE_EVERY_S)


def remove_file() -> None:
    _path().unlink(missing_ok=True)


def snapshot() -> dict:
    """Everyone's latest state, from every live worker."""
    now = time.time()
    entries: list[dict] = []
    for f in CLASS_DIR.glob("worker-*.json"):
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        if now - data.get("t", 0) <= STALE_S:          # skip workers that have stopped
            entries += data.get("entries", [])
    return summarise(entries, now)


def summarise(entries: list[dict], now: float) -> dict:
    cameras = [e for e in entries if e.get("source") == "camera"]
    fresh = [e for e in cameras if now - e.get("t", 0) <= STALE_S]
    readings = sorted(round(e["bpm"], 1) for e in fresh
                      if e.get("bpm") is not None and e.get("status") in READING_STATUSES)
    checks = [[e["check"]["tapped"], e["check"]["camera"]] for e in entries if e.get("check")]
    return {
        "connected": len(cameras),
        "measuring": sum(1 for e in fresh if e.get("measuring")),
        "readings": readings,
        "median": round(statistics.median(readings), 1) if readings else None,
        "checks": checks,
    }
