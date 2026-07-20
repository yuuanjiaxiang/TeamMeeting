import datetime as dt
import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

import migrate_org_data as migration


def create_fixture(database):
    with closing(sqlite3.connect(database)) as conn:
        conn.executescript(
            """
            CREATE TABLE org_units (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                parent_id INTEGER,
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                display_name TEXT NOT NULL,
                org_unit_id INTEGER,
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE team_posts (
                id INTEGER PRIMARY KEY,
                title TEXT,
                user_id INTEGER,
                org_unit_id INTEGER
            );
            CREATE TABLE meetings (
                id INTEGER PRIMARY KEY,
                title TEXT,
                created_by INTEGER,
                org_unit_id INTEGER
            );
            INSERT INTO org_units(id, name, slug, parent_id) VALUES(1, 'ESS', 'ess', NULL);
            INSERT INTO org_units(id, name, slug, parent_id) VALUES(2, 'MO', 'mo', 1);
            INSERT INTO users(id, display_name, org_unit_id) VALUES(1, 'Migration User', 2);
            INSERT INTO team_posts(id, title, user_id, org_unit_id) VALUES(1, 'Legacy post', 1, 1);
            INSERT INTO meetings(id, title, created_by, org_unit_id) VALUES(1, 'Legacy meeting', 1, 1);
            """
        )
        conn.commit()


def main():
    with tempfile.TemporaryDirectory(prefix="team-loop-org-migration-") as temporary_directory:
        root = Path(temporary_directory)
        database = root / "migration.db"
        output_dir = root / "artifacts"
        create_fixture(database)
        with closing(migration.connect(database)) as conn:
            source = migration.resolve_org(conn, "ess")
            changes, skipped = migration.build_plan(conn, source, follow_current_users=True)
            if len(changes) != 2 or skipped:
                raise RuntimeError(f"Unexpected migration preview: changes={changes}, skipped={skipped}")
            stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
            backup = migration.create_backup(database, output_dir, stamp, "before_org_migration")
            applied = migration.apply_plan(conn, changes)
        manifest_payload = {
            "version": 1,
            "status": "applied",
            "database": str(database.resolve()),
            "backup": str(backup.resolve()),
            "changes": applied,
        }
        manifest = migration.write_manifest(output_dir, stamp, manifest_payload)
        with closing(sqlite3.connect(database)) as conn:
            moved = [conn.execute(f"SELECT org_unit_id FROM {table} WHERE id=1").fetchone()[0] for table in ("team_posts", "meetings")]
        if moved != [2, 2]:
            raise RuntimeError(f"Organization records were not migrated: {moved}")
        restored, _, rollback_manifest = migration.rollback_manifest(database, manifest, output_dir)
        with closing(sqlite3.connect(database)) as conn:
            rolled_back = [conn.execute(f"SELECT org_unit_id FROM {table} WHERE id=1").fetchone()[0] for table in ("team_posts", "meetings")]
        if len(restored) != 2 or rolled_back != [1, 1] or not rollback_manifest.exists():
            raise RuntimeError(f"Migration rollback failed: {rolled_back}")
        print(json.dumps({"status": "ok", "preview": 2, "applied": 2, "rolled_back": 2}))


if __name__ == "__main__":
    main()
