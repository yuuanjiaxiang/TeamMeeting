"""Preview, apply, and roll back Team Loop organization data migrations.

The safe default is preview-only. Use --apply to create a SQLite backup, write a
row-level manifest, and then update organization ownership in one transaction.
"""

import argparse
import datetime as dt
import json
import sqlite3
from contextlib import closing
from pathlib import Path


OWNED_TABLES = {
    "team_posts": {"owner": "user_id", "label": "title"},
    "meetings": {"owner": "created_by", "label": "title"},
}


def connect(database):
    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def active_orgs(conn):
    rows = [dict(row) for row in conn.execute(
        "SELECT id, name, slug, parent_id, active FROM org_units WHERE active=1 ORDER BY id"
    )]
    by_id = {row["id"]: row for row in rows}

    def path_for(row):
        parts = []
        current = row
        seen = set()
        while current and current["id"] not in seen:
            seen.add(current["id"])
            parts.append(current["slug"])
            current = by_id.get(current["parent_id"])
        return "/".join(reversed(parts))

    for row in rows:
        row["path"] = path_for(row)
    return rows


def resolve_org(conn, reference):
    reference = str(reference or "").strip().strip("/")
    if not reference:
        raise ValueError("Organization reference cannot be empty")
    rows = active_orgs(conn)
    lowered = reference.casefold()
    matches = [
        row for row in rows
        if str(row["id"]) == reference
        or row["path"].casefold() == lowered
        or row["slug"].casefold() == lowered
        or row["name"].casefold() == lowered
    ]
    if not matches:
        raise ValueError(f"Organization not found: {reference}")
    if len(matches) > 1:
        paths = ", ".join(row["path"] for row in matches)
        raise ValueError(f"Organization reference is ambiguous: {reference} ({paths})")
    return matches[0]


def is_descendant(org_id, ancestor_id, by_id):
    current = by_id.get(org_id)
    seen = set()
    while current and current["id"] not in seen:
        if current["id"] == ancestor_id:
            return True
        seen.add(current["id"])
        current = by_id.get(current["parent_id"])
    return False


def build_plan(conn, source, target=None, follow_current_users=False, include_users=False, allow_cross_branch=False):
    orgs = active_orgs(conn)
    by_id = {row["id"]: row for row in orgs}
    changes = []
    skipped = []

    if target and not allow_cross_branch and not is_descendant(target["id"], source["id"], by_id):
        raise ValueError("Target must be the source organization or one of its descendants; use --allow-cross-branch to override")

    for table, config in OWNED_TABLES.items():
        rows = conn.execute(
            f"""
            SELECT item.id, item.org_unit_id, item.{config['label']} AS label,
                   item.{config['owner']} AS owner_id, owner.org_unit_id AS owner_org_unit_id
            FROM {table} item
            LEFT JOIN users owner ON owner.id=item.{config['owner']}
            WHERE item.org_unit_id=?
            ORDER BY item.id
            """,
            (source["id"],),
        ).fetchall()
        for row in rows:
            destination_id = row["owner_org_unit_id"] if follow_current_users else target["id"]
            if not destination_id or destination_id == row["org_unit_id"]:
                skipped.append({"table": table, "id": row["id"], "reason": "owner has no different current organization"})
                continue
            if destination_id not in by_id:
                skipped.append({"table": table, "id": row["id"], "reason": "destination organization is inactive or missing"})
                continue
            if not allow_cross_branch and not is_descendant(destination_id, source["id"], by_id):
                skipped.append({"table": table, "id": row["id"], "reason": "owner organization is outside source subtree"})
                continue
            changes.append({
                "table": table,
                "id": row["id"],
                "label": row["label"] or "",
                "owner_id": row["owner_id"],
                "from_org_unit_id": row["org_unit_id"],
                "to_org_unit_id": destination_id,
                "to_org_path": by_id[destination_id]["path"],
            })

    if include_users:
        if follow_current_users:
            raise ValueError("--include-users cannot be combined with --follow-current-users")
        for row in conn.execute(
            "SELECT id, display_name FROM users WHERE active=1 AND org_unit_id=? ORDER BY id",
            (source["id"],),
        ).fetchall():
            changes.append({
                "table": "users",
                "id": row["id"],
                "label": row["display_name"] or "",
                "from_org_unit_id": source["id"],
                "to_org_unit_id": target["id"],
                "to_org_path": target["path"],
            })
    return changes, skipped


def create_backup(database, output_dir, stamp, suffix):
    output_dir.mkdir(parents=True, exist_ok=True)
    backup_path = output_dir / f"{database.stem}_{suffix}_{stamp}.db"
    with closing(connect(database)) as source, closing(sqlite3.connect(backup_path)) as destination:
        source.backup(destination)
    return backup_path


def write_manifest(output_dir, stamp, payload, suffix="org_migration"):
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{suffix}_{stamp}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def apply_plan(conn, changes):
    applied = []
    conn.execute("BEGIN IMMEDIATE")
    try:
        for change in changes:
            cursor = conn.execute(
                f"UPDATE {change['table']} SET org_unit_id=? WHERE id=? AND org_unit_id=?",
                (change["to_org_unit_id"], change["id"], change["from_org_unit_id"]),
            )
            if cursor.rowcount != 1:
                raise RuntimeError(f"Row changed after preview: {change['table']}#{change['id']}")
            applied.append(change)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return applied


def rollback_manifest(database, manifest_path, output_dir):
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    changes = payload.get("changes") or []
    if payload.get("status") != "applied" or not changes:
        raise ValueError("Manifest does not contain an applied migration")
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = create_backup(database, output_dir, stamp, "before_org_rollback")
    restored = []
    with closing(connect(database)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for change in reversed(changes):
                if change.get("table") not in {*OWNED_TABLES, "users"}:
                    raise ValueError(f"Unsupported table in manifest: {change.get('table')}")
                cursor = conn.execute(
                    f"UPDATE {change['table']} SET org_unit_id=? WHERE id=? AND org_unit_id=?",
                    (change["from_org_unit_id"], change["id"], change["to_org_unit_id"]),
                )
                if cursor.rowcount != 1:
                    raise RuntimeError(f"Cannot roll back changed row: {change['table']}#{change['id']}")
                restored.append(change)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    rollback_payload = {
        "version": 1,
        "status": "rolled_back",
        "database": str(database.resolve()),
        "source_manifest": str(manifest_path.resolve()),
        "backup": str(backup_path.resolve()),
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "changes": restored,
    }
    rollback_path = write_manifest(output_dir, stamp, rollback_payload, "org_rollback")
    return restored, backup_path, rollback_path


def print_plan(source, target, changes, skipped, follow_current_users):
    mode = "follow each owner's current organization" if follow_current_users else f"move to {target['path']}"
    print(f"Source: {source['path']} (id={source['id']})")
    print(f"Mode: {mode}")
    counts = {}
    for change in changes:
        counts[change["table"]] = counts.get(change["table"], 0) + 1
    print(f"Planned rows: {len(changes)} {json.dumps(counts, ensure_ascii=False, sort_keys=True)}")
    print(f"Skipped rows: {len(skipped)}")
    for change in changes[:20]:
        print(f"  {change['table']}#{change['id']}: {change['label'][:50]} -> {change['to_org_path']}")
    if len(changes) > 20:
        print(f"  ... and {len(changes) - 20} more rows")


def main():
    parser = argparse.ArgumentParser(description="Safely migrate Team Loop organization-owned data")
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--source", help="Source organization id, slug, name, or path such as ess/mo")
    parser.add_argument("--target", help="Target organization id, slug, name, or path")
    parser.add_argument("--follow-current-users", action="store_true", help="Move each record to its owner's current organization")
    parser.add_argument("--include-users", action="store_true", help="Also move active users from source to the explicit target")
    parser.add_argument("--allow-cross-branch", action="store_true", help="Allow moving data outside the source subtree")
    parser.add_argument("--apply", action="store_true", help="Apply the previewed migration after creating a backup")
    parser.add_argument("--rollback", type=Path, help="Roll back an applied migration manifest")
    parser.add_argument("--output-dir", type=Path, help="Backup and manifest directory; defaults beside the database")
    args = parser.parse_args()

    database = args.database.resolve()
    if not database.exists():
        parser.error(f"Database does not exist: {database}")
    output_dir = (args.output_dir or (database.parent / "org_migrations")).resolve()
    if args.rollback:
        restored, backup_path, rollback_path = rollback_manifest(database, args.rollback.resolve(), output_dir)
        print(f"Rolled back {len(restored)} rows")
        print(f"Backup: {backup_path}")
        print(f"Rollback manifest: {rollback_path}")
        return
    if not args.source:
        parser.error("--source is required unless --rollback is used")
    if not args.follow_current_users and not args.target:
        parser.error("Use --target or --follow-current-users")

    with closing(connect(database)) as conn:
        source = resolve_org(conn, args.source)
        target = resolve_org(conn, args.target) if args.target else None
        changes, skipped = build_plan(
            conn,
            source,
            target=target,
            follow_current_users=args.follow_current_users,
            include_users=args.include_users,
            allow_cross_branch=args.allow_cross_branch,
        )
        print_plan(source, target, changes, skipped, args.follow_current_users)
        if not args.apply:
            print("Preview only. Re-run with --apply after reviewing the rows above.")
            return
        if not changes:
            print("No rows require migration.")
            return
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = create_backup(database, output_dir, stamp, "before_org_migration")
        applied = apply_plan(conn, changes)

    manifest_payload = {
        "version": 1,
        "status": "applied",
        "database": str(database),
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": source,
        "target": target,
        "mode": "follow_current_users" if args.follow_current_users else "explicit_target",
        "backup": str(backup_path.resolve()),
        "changes": applied,
        "skipped": skipped,
    }
    manifest_path = write_manifest(output_dir, stamp, manifest_payload)
    print(f"Applied rows: {len(applied)}")
    print(f"Backup: {backup_path}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
