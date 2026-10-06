import os
import sys
import tempfile
from pathlib import Path
from forum_smoke_test import start_server, login, request_json


def main():
    with tempfile.TemporaryDirectory(prefix="meeting-batch-") as folder:
        os.environ.update(TEAM_LOOP_DB_PATH=str(Path(folder) / "test.db"), TEAM_LOOP_DATA_DIR=folder,
                          TEAM_LOOP_BACKUP_DIR=str(Path(folder) / "backups"), TEAM_LOOP_ENV="gray")
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        import server as app
        app.init_db()
        with app.connect() as conn:
            option = conn.execute("SELECT o.id FROM meeting_topic_options o JOIN meeting_topic_types t ON t.id=o.type_id JOIN users u ON u.org_unit_id=t.org_unit_id WHERE u.username='admin' AND o.active=1 AND t.active=1 LIMIT 1").fetchone()[0]
        server, thread = start_server(app.Handler)
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            admin = login(base, 'admin', 'admin123')
            payload = {'dates': [{'date': '2027-01-05'}, {'date': '2027-02-08'}], 'items': [{'option_id': option}]}
            result = request_json(admin, base + '/api/meetings/batch-agenda', 'POST', payload)
            assert result['added'] == 2 and result['created'] == 2, result
            again = request_json(admin, base + '/api/meetings/batch-agenda', 'POST', payload)
            assert again['added'] == 0 and again['created'] == 0 and again['skipped'] == 2
            request_json(admin, base + '/api/meetings/batch-agenda', 'POST', {**payload, 'dates': [{'date': 'bad'}]}, 400)
            request_json(admin, base + '/api/meetings/batch-agenda', 'POST', {**payload, 'items': [{'option_id': option, 'owner_id': 999999}]}, 400)
            with app.connect() as conn:
                meeting_id = conn.execute("SELECT id FROM meetings WHERE meeting_date='2027-01-05'").fetchone()[0]
                conn.execute("UPDATE meetings SET status='completed' WHERE id=?", (meeting_id,))
            failed = {**payload, 'dates': [{'date': '2027-03-01'}, {'date': '2027-01-05', 'meeting_id': meeting_id}]}
            request_json(admin, base + '/api/meetings/batch-agenda', 'POST', failed, 409)
            with app.connect() as conn:
                assert conn.execute("SELECT COUNT(*) FROM meetings WHERE meeting_date='2027-03-01'").fetchone()[0] == 0
            print('Cross-month agenda: create, duplicate skip, validation, locked meeting rollback OK')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(5)


if __name__ == '__main__':
    main()
