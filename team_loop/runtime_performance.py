"""Bounded background maintenance and cacheable public assets, not business data."""
import gzip
import threading
import time
import traceback
from functools import lru_cache
from pathlib import Path


class MaintenanceGate:
    def __init__(self, interval=60):
        self.interval = interval
        self.lock = threading.Lock()
        self.running = False
        self.next_check = 0

    def schedule(self, callback):
        with self.lock:
            if self.running or time.monotonic() < self.next_check:
                return False
            self.running = True

        def run():
            try:
                callback()
            except Exception:
                # Failed backups remain visible in server logs and retry next minute.
                traceback.print_exc()
            finally:
                with self.lock:
                    self.running = False
                    self.next_check = time.monotonic() + self.interval

        threading.Thread(target=run, name="daily-backup-check", daemon=True).start()
        return True


backup_gate = MaintenanceGate()


@lru_cache(maxsize=16)
def _small_asset(path, modified_ns, size, compressed):
    content = Path(path).read_bytes()
    return gzip.compress(content, compresslevel=5, mtime=0) if compressed else content


def serve_asset(handler, path, mime):
    stat = path.stat()
    accepted = {}
    for token in (handler.headers.get("Accept-Encoding") or "").split(","):
        parts = token.strip().split(";")
        try:
            accepted[parts[0].strip()] = float(parts[1].strip().removeprefix("q=")) if len(parts) > 1 else 1
        except ValueError:
            continue
    compressed = accepted.get("gzip", accepted.get("*", 0)) > 0 and stat.st_size > 1024 and (
        mime.startswith("text/") or mime in {"application/javascript", "application/json", "image/svg+xml"}
    )
    etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}-{int(compressed)}"'
    unchanged = etag in (handler.headers.get("If-None-Match") or "").split(", ")
    handler.send_response(304 if unchanged else 200)
    handler.send_header("ETag", etag)
    handler.send_header("Cache-Control", "no-cache, must-revalidate")
    handler.send_header("Vary", "Accept-Encoding")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Connection", "close")
    handler.close_connection = True
    if unchanged:
        handler.end_headers()
        return
    if stat.st_size <= 2 * 1024 * 1024:
        content = _small_asset(str(path), stat.st_mtime_ns, stat.st_size, compressed)
    else:
        content = path.read_bytes()
        if compressed:
            content = gzip.compress(content, compresslevel=5, mtime=0)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(content)))
    if compressed:
        handler.send_header("Content-Encoding", "gzip")
    handler.end_headers()
    for offset in range(0, len(content), 64 * 1024):
        handler.wfile.write(content[offset:offset + 64 * 1024])
    handler.wfile.flush()
