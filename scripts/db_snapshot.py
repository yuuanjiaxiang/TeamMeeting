import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


def snapshot(source: Path, target: Path) -> None:
    if not source.exists():
        raise SystemExit(f"Source database does not exist: {source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.unlink(missing_ok=True)

    try:
        with closing(sqlite3.connect(source)) as source_conn, closing(sqlite3.connect(temporary)) as target_conn:
            source_conn.backup(target_conn)
            result = target_conn.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise RuntimeError(f"SQLite integrity check failed: {result}")
            target_conn.commit()
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)

    print(f"Database snapshot created: {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a consistent SQLite database snapshot")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    args = parser.parse_args()
    snapshot(args.source.resolve(), args.target.resolve())


if __name__ == "__main__":
    main()
