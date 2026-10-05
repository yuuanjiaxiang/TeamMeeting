import threading
from http.server import ThreadingHTTPServer

from .config import HTTP_MAX_WORKERS, HTTP_REQUEST_QUEUE_SIZE


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    """Thread-per-request server with a bounded number of active workers."""

    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = HTTP_REQUEST_QUEUE_SIZE

    def __init__(self, server_address, request_handler_class, max_workers=None):
        self.max_workers = max_workers or HTTP_MAX_WORKERS
        self._worker_slots = threading.BoundedSemaphore(self.max_workers)
        super().__init__(server_address, request_handler_class)

    def process_request(self, request, client_address):
        request.settimeout(20)
        if not self._worker_slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                payload = b'{"error":"Server busy; retry later"}'
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nRetry-After: 2\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " + str(len(payload)).encode("ascii") + b"\r\n\r\n" + payload)
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._worker_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._worker_slots.release()
