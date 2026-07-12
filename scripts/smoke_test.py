import argparse
import json
import socket
import sys
from urllib.parse import urlsplit


def request(base_url: str, path: str, expect_json: bool = True):
    parsed = urlsplit(base_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 80
    request_bytes = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Connection: close\r\n"
        "Accept: application/json,text/html\r\n\r\n"
    ).encode("ascii")
    try:
        with socket.create_connection((host, port), timeout=10) as connection:
            connection.sendall(request_bytes)
            chunks = []
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                chunks.append(chunk)
    except OSError as exc:
        raise RuntimeError(f"{path} is unavailable: {exc}") from exc

    response = b"".join(chunks)
    headers, separator, body = response.partition(b"\r\n\r\n")
    if not separator:
        raise RuntimeError(f"{path} returned an invalid HTTP response")
    status_line = headers.split(b"\r\n", 1)[0].decode("ascii", errors="replace")
    try:
        status = int(status_line.split()[1])
    except (IndexError, ValueError) as exc:
        raise RuntimeError(f"{path} returned an invalid status line: {status_line}") from exc
    if status != 200:
        raise RuntimeError(f"{path} returned HTTP {status}")
    if expect_json:
        return json.loads(body.decode("utf-8"))
    return body.decode("utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run read-only Team Loop deployment smoke tests")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--environment")
    parser.add_argument("--release")
    args = parser.parse_args()

    health = request(args.base_url, "/api/health")
    if health.get("status") != "ok" or health.get("database") != "ok":
        raise RuntimeError(f"Health check failed: {health}")
    if args.environment and health.get("environment") != args.environment:
        raise RuntimeError(f"Expected environment {args.environment}, got {health.get('environment')}")
    if args.release and health.get("release") != args.release:
        raise RuntimeError(f"Expected release {args.release}, got {health.get('release')}")

    page = request(args.base_url, "/", expect_json=False)
    if "Team Loop" not in page:
        raise RuntimeError("Home page marker was not found")

    for path in ("/api/members", "/api/rules", "/api/links", "/api/shifts", "/api/thank-you"):
        request(args.base_url, path)

    print(json.dumps({"status": "ok", "health": health}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
