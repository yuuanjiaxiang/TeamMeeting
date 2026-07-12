# Team Loop project map

## Primary ownership

| Concern | Primary location | Also inspect |
| --- | --- | --- |
| Tables and migrations | `server.py:init_db` | seed functions, backup verification |
| Authentication and API routing | `server.py:Handler` | `route_module`, current-user helpers |
| Permissions | `MODULE_CATALOG`, type defaults | `static/app.js` access helpers and navigation |
| Page markup and dialogs | `static/index.html` | render functions in `static/app.js` |
| State, rendering, interactions | `static/app.js` | related backend endpoint |
| Visual design and responsiveness | `static/style.css` | theme overrides near the bottom |
| Development reload | `scripts/dev_server.py` | `start_hot_server.bat` |
| Gray/production release | `deploy.ps1` | batch wrappers, smoke and snapshot scripts |
| User and developer docs | `docs/` | `README.md`, this skill |

## Domain invariants

- A user owns one member profile; inactive users disappear from current member views while history remains.
- Guest modules require matching backend and frontend public-module declarations.
- User-type permissions include view/create/edit/delete; UI hiding never replaces server checks.
- Past morning-meeting dates are read-only; unfinished items inherit through a root chain.
- Completed or archived meetings lock agenda and minutes until an admin reopens them.
- Red and black scores remain separate; do not silently convert to a net score.
- A user may edit/delete only allowed Thank You records; weekly recipient limits come from settings.
- Link edits and deletes are available to allowed internal users, with soft deletion and audit history.
- Gray uses a production snapshot and never writes its test data back to production.

## High-risk areas

- `server.py` is intentionally monolithic; route ordering can shadow dynamic paths.
- `static/app.js` renders HTML strings; missing `escapeHtml()` creates stored-XSS risk.
- Sessions are process memory; restarting the service signs users out.
- SQLite files cannot be replaced while another Windows process holds them open.
- Theme-specific CSS appears after base CSS and can override new styles.
- Development hot reload on port 8000 may point at the main database; use Gray for destructive tests.

