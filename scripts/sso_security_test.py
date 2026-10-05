"""Isolated regression checks for SSO state consumption and HTTP boundaries."""

import concurrent.futures
import datetime as dt
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="team-loop-sso-security-") as directory:
        os.environ["TEAM_LOOP_DB_PATH"] = str(Path(directory) / "security.db")
        os.environ["TEAM_LOOP_DATA_DIR"] = directory
        os.environ["TEAM_LOOP_ENV"] = "gray"
        sys.path.insert(0, str(ROOT))
        import server as app
        import team_loop.handlers.accounts as accounts
        import team_loop.sso_http as http

        app.init_db()
        config = {
            "enabled": True, "mode": "manual", "client_id": "test-client",
            "client_secret": "", "authorization_url": "http://localhost/authorize",
            "token_url": "http://localhost/token", "userinfo_url": "http://localhost/userinfo",
        }

        class SecurityTests(unittest.TestCase):
            def seed_state(self, state, expired=False):
                now = dt.datetime.now().replace(microsecond=0)
                expires = now + dt.timedelta(minutes=-1 if expired else 10)
                with app.connect() as conn:
                    conn.execute(
                        """INSERT INTO sso_login_states
                        (state_hash, nonce, code_verifier, redirect_uri, return_to, created_at, expires_at)
                        VALUES(?,?,?,?,?,?,?)""",
                        (app.token_digest(state), "nonce", "verifier", "http://localhost/api/sso/callback",
                         "/org/ess?view=meetings", now.isoformat(), expires.isoformat()),
                    )

            def callback(self, state):
                handler = object.__new__(accounts.AccountsHandlerMixin)
                try:
                    handler.complete_sso_login({"code": ["test-code"], "state": [state]})
                except app.AppError as exc:
                    return exc.status, exc.message
                self.fail("Callback unexpectedly succeeded")

            def test_concurrent_and_replayed_state(self):
                self.seed_state("concurrent")
                with patch.object(accounts, "sso_configuration", return_value=config), patch.object(
                    accounts, "fetch_json", side_effect=app.AppError(502, "provider unavailable")
                ) as fetch:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                        results = list(executor.map(lambda _: self.callback("concurrent"), range(8)))
                    self.assertEqual(sum(status == 502 for status, _ in results), 1)
                    self.assertEqual(sum(status == 400 for status, _ in results), 7)
                    self.assertEqual(fetch.call_count, 1)
                    self.assertEqual(self.callback("concurrent")[0], 400)
                    self.assertEqual(fetch.call_count, 1)

            def test_expired_state_never_contacts_provider(self):
                self.seed_state("expired", expired=True)
                with patch.object(accounts, "sso_configuration", return_value=config), patch.object(accounts, "fetch_json") as fetch:
                    self.assertEqual(self.callback("expired")[0], 400)
                    fetch.assert_not_called()

            def test_timeout_becomes_gateway_error(self):
                for error in (TimeoutError("pool busy"), TimeoutError("socket timed out")):
                    with patch.object(http, "_fetch_once", side_effect=error):
                        with self.assertRaises(app.AppError) as caught:
                            http.fetch_json("http://localhost/userinfo")
                        self.assertEqual(caught.exception.status, 502)

            def test_redirects_do_not_forward_tokens(self):
                for method, location in (("GET", "http://localhost:8001/userinfo"), ("POST", "/next")):
                    with patch.object(http, "_fetch_once", return_value=(302, {"Location": location}, b"")) as fetch:
                        with self.assertRaises(app.AppError) as caught:
                            http.fetch_json("http://localhost/token", method=method, headers={"Authorization": "Bearer test"})
                        self.assertEqual(caught.exception.status, 502)
                        self.assertEqual(fetch.call_count, 1)

            def test_return_target_whitelist(self):
                for target in ("https://evil.example", "//evil.example", "/api/settings", "/org/ess\\evil", "/org/ess\n"):
                    self.assertEqual(app.sanitize_sso_return_to(target), "")
                self.assertEqual(app.sanitize_sso_return_to("/org/ess/mo/ws?view=meetings"), "/org/ess/mo/ws?view=meetings")

            def test_userinfo_business_errors_are_redacted(self):
                discovery = {"userinfo_endpoint": "http://localhost/userinfo"}
                settings = {**config, "profile": "sicarrier", "scopes": "base.profile"}
                token = "secret/token+value"
                with patch.object(http, "_fetch_once", return_value=(200, {},
                    b'{"errorCode":"INVALID_TOKEN","errorDesc":"bad secret/token+value"}')):
                    with self.assertRaises(app.AppError) as caught:
                        http.fetch_sso_userinfo(discovery, settings, token)
                    self.assertEqual(caught.exception.status, 502)
                    self.assertIn("INVALID_TOKEN", caught.exception.message)
                    self.assertNotIn(token, caught.exception.message)

            def test_query_userinfo_never_redirects(self):
                settings = {**config, "profile": "sicarrier", "scopes": "base.profile"}
                with patch.object(http, "_fetch_once", return_value=(302, {"Location": "/next"}, b"")) as fetch:
                    with self.assertRaises(app.AppError):
                        http.fetch_sso_userinfo({"userinfo_endpoint": "http://localhost/userinfo"}, settings, "test-token")
                    self.assertEqual(fetch.call_count, 1)

            def test_sicarrier_requires_manual_and_secret(self):
                settings = {**config, "profile": "sicarrier", "mode": "discovery"}
                self.assertIn("Sicarrier 手动 OAuth2 配置方式", app.sso_missing_fields(settings))
                self.assertIn("Sicarrier Client Secret", app.sso_missing_fields(settings))

        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SecurityTests))
        if not result.wasSuccessful():
            raise SystemExit(1)


if __name__ == "__main__":
    main()
