# Deployment note: multi-session authentication

## What changed
- New table `AuthSession` (migration `20261111090706_add_auth_sessions`): one row per signed-in
  browser/device. A user has many sessions; a token hash belongs to exactly one session.
- The cookie (`content_studio_session`) holds a random 32-byte token; only its SHA-256 is stored.
- Login creates a new row and never touches other rows (it only deletes rows already expired).
- Logout deletes only the row for the cookie in the request.
- Deactivated users are rejected on every request; deleting a user cascades to their sessions.

## Deploy effects
- The migration clears the legacy `User.sessionToken` / `sessionExpiresAt` values, so **all current
  sessions are invalidated once. Every user must log in again after deployment.**
- After that, sessions are independent: different users, and the same user on several browsers,
  stay signed in simultaneously; logging out of one browser leaves the others.
- No user, BrandMembership or other data is changed.

## Deprecated, unused columns
`User.sessionToken` and `User.sessionExpiresAt` remain in the schema but are no longer read or
written (always NULL). Drop them in a **future** release, not this one.

## Known behaviour (unchanged, separate decision)
Password reset does **not** revoke existing sessions. `revokeUserSessions(userId)` exists in
`lib/auth.js` for that, but nothing calls it yet.

## Production verification required
The old single-session design explains the *same account* being signed out by a second login. It
does not explain two genuinely different User rows signing each other out. If Arian and Alireza are
meant to be separate accounts, confirm after deployment that they are distinct `User` ids with
distinct emails (admin → Users). If they were sharing one login, create a separate account for each.
