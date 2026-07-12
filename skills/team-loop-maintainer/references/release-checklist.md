# Team Loop release checklist

## Before editing

- Read the relevant docs and inspect `git status -sb`.
- Identify user roles and affected modules.
- Decide whether the change needs schema migration, audit, recycle-bin, or backup behavior.

## Before gray

- Run Python compilation, JavaScript syntax, and `git diff --check`.
- Verify no file under `data/` is staged.
- Confirm migrations are idempotent.
- Confirm the gray port and production port are distinct.

## Gray verification

- Check `/api/health` reports `environment=gray` and `database=ok`.
- Test success, invalid input, repeat action, and permission failure.
- Test desktop and narrow viewport for UI changes.
- Verify gray writes do not appear in production.
- Re-run Gray once when deployment scripts or migrations changed; repeated deployment must work on Windows.

## Before commit and push

- Review `git diff --stat` and the full relevant diff.
- Update user, developer, API, database, or deployment docs as required.
- Stage explicit intended paths.
- Commit only after checks pass.
- Push only when the user explicitly requests it.

## Before production promotion

- Obtain explicit approval.
- Confirm users have stopped critical writes.
- Ensure Gray matches the intended commit.
- Confirm a current production backup exists.
- Run `Promote`, then health and smoke tests.
- Keep rollback metadata and report the deployed release ID.

