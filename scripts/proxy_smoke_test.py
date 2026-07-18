import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


def request_json(url, method="GET", payload=None, headers=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method=method,
        headers={
            "Connection": "close",
            **({"Content-Type": "application/json"} if body is not None else {}),
            **(headers or {}),
        },
    )
    with urlopen(request, timeout=15) as response:
        return response.status, dict(response.headers.items()), json.load(response)


def main():
    with tempfile.TemporaryDirectory(prefix="team-loop-proxy-") as temporary_directory:
        os.environ["TEAM_LOOP_DB_PATH"] = str(Path(temporary_directory) / "proxy-smoke.db")
        os.environ["TEAM_LOOP_DATA_DIR"] = temporary_directory
        os.environ["TEAM_LOOP_BACKUP_DIR"] = str(Path(temporary_directory) / "backups")
        os.environ["TEAM_LOOP_ENV"] = "gray"
        os.environ["TEAM_LOOP_TRUST_PROXY"] = "1"
        sys.path.insert(0, str(ROOT))
        import server as app

        app.init_db()
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"
        forwarded_headers = {
            "X-Forwarded-For": "203.0.113.42",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "meeting.example.com",
        }
        try:
            status, response_headers, result = request_json(
                f"{base_url}/api/login",
                "POST",
                {"username": "admin", "password": "admin123"},
                forwarded_headers,
            )
            cookie = response_headers.get("Set-Cookie", "")
            if status != 200 or not result.get("user") or "; Secure" not in cookie:
                raise RuntimeError(f"HTTPS proxy login did not issue a Secure session cookie: {cookie}")
            session_cookie = cookie.split(";", 1)[0]
            _, _, sessions_result = request_json(
                f"{base_url}/api/sessions",
                headers={**forwarded_headers, "Cookie": session_cookie},
            )
            sessions = sessions_result.get("sessions") or []
            if not sessions or sessions[0].get("ip_address") != "203.0.113.42":
                raise RuntimeError(f"Forwarded client IP was not recorded: {sessions}")
            print(json.dumps({"status": "ok", "secure_cookie": True, "client_ip": sessions[0]["ip_address"]}))
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


if __name__ == "__main__":
    main()
