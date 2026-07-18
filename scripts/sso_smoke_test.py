import argparse
import base64
import hashlib
import http.cookiejar
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]


class FakeOAuth2Handler(BaseHTTPRequestHandler):
    issuer = ""
    expected_challenge = ""
    employee_id = "E10086"
    subject = "smoke-subject"
    display_name = "SSO 冒烟用户"
    groups = ["SMOKE-MO"]

    def log_message(self, _format, *_args):
        return

    def send_json(self, payload, status=200):
        content = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/.well-known/openid-configuration":
            self.send_json(
                {
                    "issuer": self.issuer,
                    "authorization_endpoint": f"{self.issuer}/authorize",
                    "token_endpoint": f"{self.issuer}/token",
                    "userinfo_endpoint": f"{self.issuer}/userinfo",
                    "token_endpoint_auth_methods_supported": ["none"],
                }
            )
            return
        if parsed.path == "/authorize":
            query = parse_qs(parsed.query)
            self.__class__.expected_challenge = query["code_challenge"][0]
            callback = f"{query['redirect_uri'][0]}?{urlencode({'code': 'smoke-code', 'state': query['state'][0]})}"
            self.send_response(302)
            self.send_header("Location", callback)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if parsed.path == "/userinfo":
            if self.headers.get("Authorization") != "Bearer smoke-access-token":
                self.send_json({"error": "invalid_token"}, 401)
                return
            self.send_json({"sub": self.subject, "employee_id": self.employee_id, "name": self.display_name, "groups": self.groups})
            return
        self.send_error(404)

    def do_POST(self):
        if urlparse(self.path).path != "/token":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(length).decode("utf-8"))
        verifier = form.get("code_verifier", [""])[0]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
        if form.get("code", [""])[0] != "smoke-code" or challenge != self.expected_challenge:
            self.send_json({"error": "invalid_grant"}, 400)
            return
        self.send_json({"access_token": "smoke-access-token", "token_type": "Bearer"})


def start_server(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def main():
    parser = argparse.ArgumentParser(description="Run an isolated OAuth2 SSO integration smoke test")
    parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="team-loop-sso-") as temporary_directory:
        os.environ["TEAM_LOOP_DB_PATH"] = str(Path(temporary_directory) / "sso-smoke.db")
        os.environ["TEAM_LOOP_DATA_DIR"] = temporary_directory
        os.environ["TEAM_LOOP_BACKUP_DIR"] = str(Path(temporary_directory) / "backups")
        os.environ["TEAM_LOOP_ENV"] = "gray"
        sys.path.insert(0, str(ROOT))
        import server as app

        oidc_server, oidc_thread = start_server(FakeOAuth2Handler)
        FakeOAuth2Handler.issuer = f"http://127.0.0.1:{oidc_server.server_port}"
        app.init_db()
        app_server, app_thread = start_server(app.Handler)
        app_url = f"http://127.0.0.1:{app_server.server_port}"
        try:
            with app.connect() as conn:
                values = {
                    "sso_enabled": "1",
                    "sso_auto_login": "1",
                    "sso_mode": "manual",
                    "sso_authorization_url": f"{FakeOAuth2Handler.issuer}/authorize",
                    "sso_token_url": f"{FakeOAuth2Handler.issuer}/token",
                    "sso_userinfo_url": f"{FakeOAuth2Handler.issuer}/userinfo",
                    "sso_client_id": "team-loop-smoke",
                    "sso_client_secret": "smoke-secret",
                    "sso_redirect_uri": f"{app_url}/api/sso/callback",
                    "sso_username_claim": "employee_id",
                    "sso_group_claim": "groups",
                    "sso_auto_provision": "1",
                    "sso_default_user_type": app.DEFAULT_USER_TYPE_KEY,
                }
                for key, value in values.items():
                    conn.execute("UPDATE system_settings SET value=? WHERE key=?", (value, key))
                conn.execute("UPDATE users SET employee_id='E10086' WHERE username='user'")
                conn.execute("UPDATE org_units SET sso_groups=? WHERE name='MO'", (json.dumps(["SMOKE-MO"]),))
                conn.execute("UPDATE org_units SET sso_groups=? WHERE name='WS'", (json.dumps(["SMOKE-WS"]),))

            opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            with opener.open(f"{app_url}/api/me", timeout=15) as response:
                public_profile = json.load(response)
            public_settings = public_profile.get("settings") or {}
            private_keys = {"sso_client_secret", "sso_issuer_url", "sso_authorization_url", "sso_token_url", "sso_userinfo_url"}
            if public_settings.get("sso_ready") != "1" or private_keys.intersection(public_settings):
                raise RuntimeError(f"Unsafe or incomplete public SSO settings: {public_settings}")

            admin_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            login_request = Request(
                f"{app_url}/api/login",
                data=json.dumps({"username": "admin", "password": "admin123"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with admin_opener.open(login_request, timeout=15):
                pass
            with admin_opener.open(f"{app_url}/api/settings", timeout=15) as response:
                settings = json.load(response).get("settings") or []
            secret = next((item for item in settings if item.get("key") == "sso_client_secret"), {})
            if secret.get("value") or not secret.get("configured"):
                raise RuntimeError("SSO Client Secret was echoed or not marked as configured")

            with opener.open(f"{app_url}/api/sso/login", timeout=15) as response:
                if response.status != 200:
                    raise RuntimeError(f"SSO redirect chain returned HTTP {response.status}")
            with opener.open(f"{app_url}/api/me", timeout=15) as response:
                profile = json.load(response)
            user = profile.get("user") or {}
            if user.get("username") != "user" or user.get("employee_id") != "E10086" or user.get("display_name") != "示例成员" or user.get("org_unit_name") != "MO":
                raise RuntimeError(f"Existing employee was not linked: {user}")
            with app.connect() as conn:
                identity = conn.execute(
                    "SELECT employee_id, auth_source, external_subject FROM users WHERE employee_id='E10086'"
                ).fetchone()
                employee_count = conn.execute("SELECT COUNT(*) FROM users WHERE LOWER(employee_id)=LOWER('E10086')").fetchone()[0]
            if not identity or identity["auth_source"] != "oauth2" or not identity["external_subject"]:
                raise RuntimeError("OAuth2 employee identity was not persisted")
            if employee_count != 1:
                raise RuntimeError("SSO employee matching created a duplicate user")

            FakeOAuth2Handler.groups = ["UNMAPPED-GROUP"]
            preserve_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            with preserve_opener.open(f"{app_url}/api/sso/login", timeout=15):
                pass
            with preserve_opener.open(f"{app_url}/api/me", timeout=15) as response:
                preserved = (json.load(response).get("user") or {})
            if preserved.get("org_unit_name") != "MO":
                raise RuntimeError(f"Unmapped SSO group changed the existing organization: {preserved}")

            FakeOAuth2Handler.employee_id = "E20002"
            FakeOAuth2Handler.subject = "smoke-subject-new"
            FakeOAuth2Handler.display_name = "自动建号用户"
            FakeOAuth2Handler.groups = ["SMOKE-WS"]
            provision_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
            with provision_opener.open(f"{app_url}/api/sso/login", timeout=15):
                pass
            with provision_opener.open(f"{app_url}/api/me", timeout=15) as response:
                provisioned = (json.load(response).get("user") or {})
            if provisioned.get("username") != "E20002" or provisioned.get("employee_id") != "E20002" or provisioned.get("org_unit_name") != "WS":
                raise RuntimeError(f"Automatic SSO provisioning failed: {provisioned}")
            print(json.dumps({"status": "ok", "linked": user["username"], "provisioned": provisioned["username"], "pkce": "S256"}, ensure_ascii=False))
        finally:
            app_server.shutdown()
            oidc_server.shutdown()
            app_thread.join(timeout=5)
            oidc_thread.join(timeout=5)
            app_server.server_close()
            oidc_server.server_close()


if __name__ == "__main__":
    main()
