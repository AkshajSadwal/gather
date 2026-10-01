# Gather

Gather is an original, responsive social app built with a Next.js App Router frontend and a separate Express, Socket.IO, and Prisma backend. It includes credential and Google authentication, a PostgreSQL data model, profiles and follows, posts and comments, search, stories, reels, notifications, direct messages, and one-to-one WebRTC call signaling.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker Desktop with Compose, or a compatible local PostgreSQL 16 instance

## Local setup (PowerShell)

Run these commands from `A:\in\instagram-clone`.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env`. Generate two independent secrets (do not reuse either one):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Put one generated value in `AUTH_SECRET` and another in `INTERNAL_AUTH_SECRET`. The example PostgreSQL URL targets the local container below. Keep `.env` private; it is ignored by Git.

Install packages and start the local PostgreSQL service:

```powershell
npm install
docker compose up -d postgres
```

Create the schema and realistic demo data:

```powershell
npm run db:migrate
npm run db:seed
```

Start the Express backend in one terminal and the Next.js frontend in another:

```powershell
npm run dev:backend
npm run dev:frontend
```

Open [http://localhost:3000](http://localhost:3000). Use `localhost` for both services rather than switching one URL to `127.0.0.1`; the Auth.js HttpOnly cookie must be sent to the API on the same host.

The seed creates `maya`, `noah`, `amara`, `leo`, and `sofia` with the shared local-only password `GatherDemo2026!`. These `example.test` accounts are fictional development fixtures. Do not deploy the seed password to a public environment.

## Google OAuth

Username/password registration works without external credentials. To enable Google login, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `NEXT_PUBLIC_GOOGLE_LOGIN=true`, and register this redirect URI in the Google OAuth client:

```text
http://localhost:3000/api/auth/callback/google
```

Restart the frontend after changing environment values. The OAuth secret and `INTERNAL_AUTH_SECRET` are server-only variables.

## Useful commands

```powershell
npm run db:generate
npm run db:migrate -- --name describe_change
npm run db:seed
npm test
npm run lint --workspace=@instagram-clone/backend
npm run lint --workspace=@instagram-clone/frontend
npm run lint
npm run build
```

`GET http://localhost:4000/health` reports API and database status. The upload service writes validated files below `uploads/`; the directory is ignored except for its placeholder. The current limits are 12 MB per image and 120 MB per video.

## Authentication and deployment notes

Auth.js owns login, session creation, expiry, and logout. It stores a 14-day encrypted JWT in an HttpOnly, SameSite=Lax cookie. The Express API decrypts and validates that exact Auth.js cookie using the server-only `AUTH_SECRET`; it does not mint a bearer token for browser JavaScript. Credential login is checked by Express with bcrypt, while Google sign-in calls a backend account-sync endpoint protected by `INTERNAL_AUTH_SECRET`. See [ARCHITECTURE.md](ARCHITECTURE.md).

For deployment, use HTTPS, strong unique secrets, a managed PostgreSQL database, a persistent or object-backed upload store, and a TURN relay for reliable calls across restrictive networks. Configure frontend/backend origins consistently. The bundled development Compose file is not a production database deployment.

## Project notes

- [Development workflow](DEVELOPMENT.md)
- [API and socket contract](docs/API.md)
- [Current implementation status](STATUS.md)
- [Known follow-up work](TODO.md)
