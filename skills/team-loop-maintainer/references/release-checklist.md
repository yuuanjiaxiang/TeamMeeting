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
- Run `scripts/safety_feature_test.py` when sessions, permissions, participation scopes, optimistic writes, or shifts changed.
- Verify bulk account-type changes and confirm excluded users disappear only from current business lists while history remains.
- Verify organization `all/subtree/unit` scopes, bulk organization assignment, nested `/org/...` routes, scoped business writes, and blocked deletion of organizations with children or active users.
- Verify upper meetings and announcements appear read-only in descendants, ordinary discussions do not inherit, descendants can reply/react to inherited announcements, cross-team Thank You appears for both parties and common ancestors, and unrelated sibling teams cannot see it.
- If SSO organization mapping changed, verify deepest-group matching, existing-user organization preservation when no group matches, new-user root fallback, and redirect to the final organization route.
- If authentication changed, run `python scripts\sso_smoke_test.py`; confirm existing employee IDs link without duplicate users, auto provisioning still works, local password fallback remains available, auto login cannot loop, and no SSO secret or endpoint appears in `/api/me`.
- If proxy or cookie handling changed, run `python scripts\proxy_smoke_test.py`; confirm HTTPS forwarding produces Secure cookies and stores the forwarded client IP. Validate Nginx with `nginx -t` before reload.
- Verify a non-admin with `meetings.create` can create a timed meeting and select presets, but cannot maintain topic categories or preset definitions.
- Verify attendance opens in a modal and meeting email generation works both with and without Thank You content.
- Verify the local full Emoji picker loads, searches, sends an arbitrary Emoji, and can remove the reaction without external network access.
- Run `python scripts\forum_smoke_test.py`; verify author edits, nested replies, arbitrary Emoji, announcement/pin privilege rejection, soft deletion, recycle restore, and preserved replies.
- Toggle black-score summary and detail visibility independently; verify non-admin APIs and UI hide the configured data while administrators still see and can restore it.
- Verify the score page defaults to the current month, detail rows are newest-first and scroll, and a member click opens only that member's full history.
- Verify shared date filters default to the first day of the current month through today.
- Submit a multi-day shift batch and confirm the calendar refreshes while the selected end date remains unchanged; selecting a different day should reset the range.
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
