# Status

Last updated: 2026-10-01

## Completed

- Created the project at the requested location with separate JavaScript Next.js App Router and Express/Socket.IO applications, Tailwind styling, pnpm workspace, Docker Compose, Git, and project documentation.
- Added Auth.js credentials and Google providers, normalized credential signup/login, bcrypt password storage, an HttpOnly encrypted 14-day Auth.js session, and Express/Socket.IO validation of that session. Google account synchronization uses a server-only internal secret.
- Added the PostgreSQL/Prisma relational schema and checked-in initial SQL migration for users/profiles, follows, posts/media, likes, comments, bookmarks, hashtags, notifications, conversations/messages/read receipts, stories/views, reels, and call sessions.
- Implemented profiles, public/private follow flows, cursor-paginated feeds, explore/search, posts/carousels, comments, likes, bookmarks, mentions/hashtags, notifications, local uploads with signature/size checks, and authorization for private media.
- Implemented 24-hour stories with view tracking, owner viewer lists and deletion; reels with video upload and playback controls; one-to-one persistent messaging and Socket.IO presence, typing, delivery/read updates; and Socket.IO WebRTC signaling with call lifecycle cleanup.
- Added responsive routes for login, signup, home, explore, search, reels, messages/calls, profiles, posts, and settings. Added fictional demo seed fixtures and setup/API/architecture docs.

## Validation performed

- `pnpm install --offline --frozen-lockfile`: passed with the final manifests and lockfile.
- Prisma schema validation and Prisma Client generation: passed. The initial migration SQL and PostgreSQL migration lock file are present.
- Backend JavaScript syntax check: passed for 21 backend/seed files.
- Backend automated tests: 3 unit tests passed. The PostgreSQL integration test was skipped because `localhost:5432` is unreachable.
- Frontend Next.js lint: passed with no ESLint warnings or errors.
- Frontend production build: passed; all app routes compiled.
- Started both services and smoke-checked the HTTP routes: public pages and Auth.js provider/CSRF endpoints returned 200; `/messages` and `/settings` redirected to login; unauthenticated `/api/auth/me` returned 401.
- Backend `/health` returned 503 with `database: unavailable`, as designed when PostgreSQL is down. Browser visual smoke checks covered login/signup and responsive layouts; no Playwright run was available.
- Confirmed there is no project `.env` file. Only `.env.example` is present; it contains placeholders, not real secrets.

## Current blocker

The Docker engine is unavailable in this environment, so `docker compose up -d postgres` cannot start the requested database. There is no local PostgreSQL server listening on port 5432. Consequently the initial migration has not been applied, seed data has not been inserted, and the database-backed integration tests plus signup/login/social/message persistence flows could not be exercised end to end. `prisma migrate deploy` and the seed runner both stop because the database cannot be reached. Start Docker Desktop (or PostgreSQL 16), then follow the commands in `README.md` to complete those checks.

## External configuration and known limits

- Google sign-in needs a Google OAuth client ID and secret. Credentials sign-in is wired, but persistence could not be verified without PostgreSQL.
- WebRTC uses STUN but has no TURN relay configured; restrictive NAT/firewall paths can block peer connectivity.
- Presence and active-call state use single-process memory. Multi-instance deployment needs shared Socket.IO/presence state.
- Expired stories are excluded immediately; scheduled physical row/file cleanup is not configured.
- Seeded demo media points at public sample URLs, so those remote assets need internet access.
- Remaining product follow-ups are tracked in `TODO.md`.
