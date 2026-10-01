# Development workflow

## First run

1. Copy `.env.example` to `.env`; generate independent `AUTH_SECRET` and `INTERNAL_AUTH_SECRET` values.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Install with `pnpm install`, apply the checked-in initial migration with `pnpm db:migrate`, and load demo fixtures with `pnpm db:seed`.
4. In separate terminals run `pnpm dev:backend` and `pnpm dev:frontend`.

The backend loads the root `.env` from `backend/src/config/env.js`. Prisma reads the same root file because `prisma/schema.prisma` is in the workspace root. Avoid using `127.0.0.1` for one service and `localhost` for another; the Auth.js session cookie is host-only.

## Changes

- Schema updates: edit `prisma/schema.prisma`, then create a named migration with Prisma. Do not edit generated Prisma client files.
- API work: keep route wiring in `backend/src/routes`, request behavior in controllers, shared logic in services, and access checks in middleware/controller guards.
- UI work: use App Router pages and reusable components in `frontend/components`. The API helper always includes credentials and translates the shared error envelope.
- Uploads: use multipart `media` fields. Images are limited to 12 MB each; video uploads are limited to 120 MB each. Posts can include up to 10 items.
- OAuth: configure the Google callback URL in the README and restart Next.js after changing credentials.

## Validation

```powershell
pnpm --filter @instagram-clone/backend lint
pnpm --filter @instagram-clone/backend test
pnpm lint
pnpm build
pnpm db:status
Invoke-RestMethod http://localhost:4000/health
```

The backend test suite uses a real PostgreSQL database configured by `DATABASE_URL`; it creates uniquely named test users and removes them after the run. Keep the test database separate from data you care about.
