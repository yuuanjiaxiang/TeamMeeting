---
name: team-loop-maintainer
description: Maintain, extend, debug, test, document, and deploy the Team Loop Python/SQLite/vanilla-JavaScript application. Use for Team Loop feature work, UI fixes, permission changes, API or schema changes, backup/recovery work, Windows deployment, gray releases, production promotion, and repository documentation.
---

# Team Loop Maintainer

Work from the repository root. Preserve the dependency-free Python standard-library backend, vanilla frontend, SQLite data model, Windows deployment flow, and existing Chinese product language unless the user explicitly approves an architectural change.

## Start every task

1. Read `README.md` and the relevant file under `docs/`.
2. Read `references/project-map.md` for module ownership and high-risk boundaries.
3. Run `git status -sb`; preserve unrelated worktree changes.
4. Locate code with `rg` before editing.
5. Inspect both the frontend and backend path for any permissioned feature.

Use these references conditionally:

- Read `../../docs/USER_GUIDE.md` for user-visible behavior and terminology.
- Read `../../docs/DEVELOPMENT.md` before adding modules, routes, tables, permissions, forms, or dialogs.
- Read `../../docs/API.md` for endpoint conventions.
- Read `../../docs/DATABASE.md` for schema, migration, backup, or restore work.
- Read `../../docs/DEPLOYMENT.md` for service, gray, production, or rollback work.
- Read `references/release-checklist.md` before any commit, push, gray deployment, promotion, or rollback.

## Implement changes

### Product and UI

- Keep operational pages compact, scannable, and task-focused.
- Prefer modal editing for long forms, details, and destructive confirmation.
- Use event delegation for dynamically rendered controls.
- Escape every user-controlled value before injecting HTML.
- Preserve independent scrolling for long lists and stable calendar/table dimensions.
- Verify Miro theme first, then check theme overrides and responsive breakpoints.
- Make each page reload its latest data when opened.

### Permissions

- Treat frontend visibility as presentation only.
- Enforce admin, ownership, module, and action permissions in `server.py`.
- Register new modules in `MODULE_CATALOG`, initial permissions, `module_for_path()`, frontend `pages`, and loaders.
- Treat user types as administrator-defined data. Never branch business behavior on a display name or assume fixed internal/partner type keys.
- Test admin view, admin user view, at least two custom user types, and the dynamic guest template when the change affects access.

### Backend and data

- Use parameterized SQL and one transaction for multi-step writes.
- Record significant writes with `write_audit()`.
- Prefer soft deletion and recycle-bin integration for business history.
- Add schema changes through idempotent `CREATE TABLE IF NOT EXISTS`, `ensure_column()`, and conditional updates in `init_db()`.
- Never commit or manually overwrite files under `data/`.
- Never test destructive migrations against the production database.

### Cross-module behavior

- Keep users and member profiles consistent.
- Keep workbench and morning-meeting data synchronized.
- Keep meeting state locks enforced by the server.
- Keep Thank You weekly limits and red/black independent scoring semantics.
- Keep guest access read-only and entirely driven by the reserved `guest` permission template.

## Validate

Run at minimum:

```powershell
python -m py_compile server.py scripts\dev_server.py scripts\db_snapshot.py scripts\smoke_test.py
node --check static\app.js
git diff --check
```

Then test the affected API and UI states. For frontend work, inspect desktop and narrow layouts, long text, empty data, repeated clicks, error feedback, and role-restricted controls.

For database or deployment changes, deploy Gray and test against its isolated snapshot before production promotion:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Gray
```

Do not promote or push unless the user explicitly asks.

## Update documentation

Update documentation in the same change when behavior, commands, permissions, API contracts, schema, or deployment steps change:

- User behavior: `docs/USER_GUIDE.md`
- Architecture and extension rules: `docs/DEVELOPMENT.md`
- Endpoints: `docs/API.md`
- Tables, migration, backup: `docs/DATABASE.md`
- Deployment and operations: `docs/DEPLOYMENT.md`
- Common failures: `docs/TROUBLESHOOTING.md`

Keep `README.md` concise and use it as the entry point rather than duplicating all details.

## Release

When authorized to publish:

1. Confirm only intended files are modified.
2. Run the validation suite.
3. Stage explicit paths.
4. Commit with a concise behavior-oriented message.
5. Push the requested branch.
6. Report the commit, branch, validation, and environment status.

Do not include databases, backups, runtime logs, screenshots with real employee data, credentials, or gray test records.
