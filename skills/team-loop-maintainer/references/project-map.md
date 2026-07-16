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
| Enterprise OAuth2/OIDC SSO | `server.py`, system settings, login view | Discovery/manual endpoints, PKCE, employee-ID mapping, auto login fallback, provisioning and sessions |
| User and developer docs | `docs/` | `README.md`, this skill |

## Domain invariants

- A user owns one member profile; inactive users disappear from current member views while history remains.
- Guest modules are selected through the reserved `guest` permission template; the frontend consumes `/api/me` and must not maintain a separate allowlist.
- User-type permissions include view/create/edit/delete; UI hiding never replaces server checks.
- User-type participation scopes independently control current team-member, morning, red/black, and Thank You candidate lists without deleting history.
- User types are dynamic. Only `guest` is reserved; it is read-only and cannot be assigned to an account.
- Past morning-meeting dates are read-only; unfinished items inherit through a root chain.
- Completed or archived meetings lock agenda and minutes until an admin reopens them.
- Meeting creation follows the `meetings.create` operation permission; only administrators maintain first-level topic categories and second-level presets.
- Meeting presets are batch-added through `/api/meetings/{id}/agenda-options`, with an optional owner per selected item; `meetings.start_time` is `HH:MM` or empty.
- Team discussion is a forum-style topic list with categories, search, sorting, pagination, detail replies, soft deletion, and recycle restore. Authors manage their own topics; only administrators publish announcements or pin topics.
- Discussion Emoji picker code, locale, and Emoji data are local static assets and must work without public internet access.
- Red and black scores remain separate; do not silently convert to a net score.
- Black-score summary and detail visibility are separate system settings; non-admin API responses must be filtered server-side while administrators retain full management access.
- A user may edit/delete only allowed Thank You records; weekly recipient limits come from settings.
- Link edits and deletes are available to users whose type grants the matching operation, with soft deletion and audit history.
- OAuth2 Client Secret is write-only in the UI and may be supplied with `TEAM_LOOP_SSO_CLIENT_SECRET`; public settings expose only readiness, auto-login state and button text. Employee ID is the user-management link, while external subject is the stable provider identity.
- Gray uses a production snapshot and never writes its test data back to production.

## High-risk areas

- `server.py` is intentionally monolithic; route ordering can shadow dynamic paths.
- `static/app.js` renders HTML strings; missing `escapeHtml()` creates stored-XSS risk.
- Sessions are persisted as token hashes in SQLite; authentication changes must preserve expiry, revocation, device listing, and login throttling.
- User types and morning items use optimistic versions; stale writes must return 409 instead of overwriting newer data.
- Shift batches are atomic and must reject duplicates or daily-hour conflicts before inserting any row.
- SQLite files cannot be replaced while another Windows process holds them open.
- Theme-specific CSS appears after base CSS and can override new styles.
- Development hot reload on port 8000 may point at the main database; use Gray for destructive tests.
