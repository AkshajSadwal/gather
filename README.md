# Gather

Gather is an original responsive social app with a JavaScript Next.js App Router frontend and a separate Express + Socket.IO backend. PostgreSQL and Prisma provide the persistent relational data layer. It includes credentials and Google authentication, profiles, public/private accounts, follows and follow requests, posts/carousels, likes/comments/bookmarks, search/hashtags, notifications, direct messages, stories, reels, and one-to-one voice/video calls routed through a mediasoup SFU.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker Desktop with Compose, or a compatible PostgreSQL 16 instance

## Local setup (PowerShell)

Run these commands from `A:\in\instagram-clone`.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
```

Start the backend and frontend in separate terminals:

```powershell
npm run dev:backend
npm run dev:frontend
```

Open `http://localhost:3000`. Use `localhost` consistently for local development so the host-only Auth.js session cookie is available to the frontend/API topology used by this app.

The seed creates fictional demo accounts `maya`, `noah`, `amara`, `leo`, and `sofia`, all using the local-only password `GatherDemo2026!`. Never deploy seed credentials to a public environment.

## Data architecture

- PostgreSQL stores users, profiles, follows/follow requests, blocks, posts/media metadata, likes, comments, bookmarks, hashtags, notifications, conversations/messages/read receipts, stories/views, reels, and call metadata.
- Actual image/video bytes live in the upload storage layer. Local development writes to `uploads/`; production should use object storage plus a CDN.
- Prisma is the ORM/typed query layer between the JavaScript backend and PostgreSQL.
- Username and email are normalized before writes and protected by database-level unique constraints for race-safe uniqueness.

## Authentication

Auth.js owns the browser session. Credentials login is checked by Express with bcrypt; Google sign-in uses a server-only account-sync request protected by `INTERNAL_AUTH_SECRET`. Express and Socket.IO validate the exact Auth.js cookie using the server-only `AUTH_SECRET`. No bearer token or signing key is exposed to browser JavaScript.

Generate independent secrets with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Put different values in `AUTH_SECRET` and `INTERNAL_AUTH_SECRET`.

## Privacy and safety

Gather supports public/private accounts and a user-to-user block system. Blocking is enforced server-side and removes existing follow relationships in both directions. Blocked users cannot follow, message, call, or retrieve private content across the blocked boundary. The UI exposes Block/Unblock on another user's profile.

This is an application-level privacy system, not a substitute for deployment-level access controls, moderation, abuse handling, or legal/privacy policy.

## Voice and video calls

Socket.IO carries authenticated call control and mediasoup negotiation messages. Audio/video RTP stays on mediasoup WebRTC transports; it never passes through Socket.IO or PostgreSQL.

Local development defaults to `MEDIASOUP_LISTEN_IP=127.0.0.1`. For remote devices or deployment, configure an appropriate listen interface, `MEDIASOUP_ANNOUNCED_ADDRESS`, and open the configured UDP/TCP RTC range. The current app is intentionally single-backend-instance; multi-instance deployment requires shared call/presence coordination and a Socket.IO adapter.

The current SFU setup has no TURN credentials. Some restrictive NAT/firewall configurations may still need a TURN service.

## Useful commands

```powershell
npm run db:generate
npm run db:migrate
npm run db:migrate -- --name describe_change
npm run db:seed
npm test
npm run lint --workspace=@instagram-clone/backend
npm run lint --workspace=@instagram-clone/frontend
npm run lint
npm run build
npm run test:e2e
```

`GET http://localhost:4000/health` reports API and PostgreSQL health. Current development upload limits are 12 MB per image and 120 MB per video.

## Documentation

- [Development workflow](DEVELOPMENT.md)
- [Architecture](ARCHITECTURE.md)
- [API and Socket.IO contract](docs/API.md)
- [Current status](STATUS.md)
- [Follow-up work](TODO.md)
- [Security notes](SECURITY.md)
