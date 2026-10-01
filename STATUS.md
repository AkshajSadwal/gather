# Status

Last updated: 2026-10-01

## Completed

- Created the project at the requested location with separate JavaScript Next.js App Router and Express/Socket.IO applications, Tailwind styling, npm workspaces, Docker Compose, Git, and project documentation.
- Added Auth.js credentials and Google providers, normalized credential signup/login, bcrypt password storage, an HttpOnly encrypted 14-day Auth.js session, and Express/Socket.IO validation of that session. Google account synchronization uses a server-only internal secret.
- Added the PostgreSQL/Prisma relational schema and checked-in initial SQL migration for users/profiles, follows, posts/media, likes, comments, bookmarks, hashtags, notifications, conversations/messages/read receipts, stories/views, reels, and call sessions.
- Implemented profiles, public/private follow flows, cursor-paginated feeds, explore/search, posts/carousels, comments, likes, bookmarks, mentions/hashtags, notifications, local uploads with signature/size checks, and authorization for private media.
- Implemented 24-hour stories with view tracking, owner viewer lists and deletion; reels with video upload and playback controls; one-to-one persistent messaging and Socket.IO presence, typing, delivery/read updates; and Socket.IO WebRTC signaling with call lifecycle cleanup.
- Added responsive routes for login, signup, home, explore, search, reels, messages/calls, profiles, posts, and settings. Added fictional demo seed fixtures and setup/API/architecture docs.

## Validation performed

- `npm install` completed using npm workspaces and generated `package-lock.json`; Prisma install scripts are approved in the root manifest, and the optional `unrs-resolver` script remains denied.
- Prisma schema validation and Prisma Client generation: passed. The initial migration is applied; `npm run db:status` reports the database is up to date.
- `npm run db:seed`: passed; five fictional demo accounts and social fixtures were seeded.
- Backend JavaScript syntax check: passed for 21 backend/seed files.
- Backend automated tests: all 4 tests passed, including PostgreSQL-backed signup/login, availability, uniqueness, post/media ownership, likes, bookmarks, comments, follows, stories, reels, messages/read state, and Socket.IO call lifecycle.
- Frontend Next.js lint: passed with no ESLint warnings or errors.
- Frontend production build: passed; all app routes compiled.
- Started both services through npm workspace scripts. Backend `/health`, username/email availability, demo credential login, frontend login/signup, and Auth.js provider routes returned 200.
- Browser visual smoke checks covered login/signup and responsive layouts; no Playwright run was available.
- Local `.env` files are excluded by `.gitignore` and were not committed. `.env.example` contains placeholders only.

## Current blocker

No current database blocker. PostgreSQL at the configured local URL is reachable; the initial migration is up to date, seed data was loaded, and the database-backed integration suite passed.

## External configuration and known limits

- Google sign-in needs a Google OAuth client ID and secret; Google login was not exercised.
- WebRTC signaling and lifecycle tests pass. The app uses STUN but has no TURN relay configured; restrictive NAT/firewall paths can block browser peer connectivity.
- Presence and active-call state use single-process memory. Multi-instance deployment needs shared Socket.IO/presence state.
- Expired stories are excluded immediately; scheduled physical row/file cleanup is not configured.
- Seeded demo media points at public sample URLs, so those remote assets need internet access.
- Remaining product follow-ups are tracked in `TODO.md`.
