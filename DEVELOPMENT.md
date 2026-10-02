# Development workflow

## First run

1. Copy `.env.example` to `.env`.
2. Generate independent `AUTH_SECRET` and `INTERNAL_AUTH_SECRET` values.
3. Start PostgreSQL with `docker compose up -d postgres`.
4. Run `npm install`.
5. Run `npm run db:generate` and `npm run db:migrate`.
6. Run `npm run db:seed` for fictional demo fixtures.
7. Start `npm run dev:backend` and `npm run dev:frontend` in separate terminals.

## Database changes

Edit `prisma/schema.prisma`, then create a named migration with Prisma:

```powershell
npm run db:migrate -- --name describe_change
```

Do not edit generated Prisma client files by hand.

Current schema includes identity, social graph, content/media, notifications, conversations/messages/read receipts, stories, reels, calls, and blocks.

## Code organization

- `backend/src/routes` — route wiring and middleware order
- `backend/src/controllers` — request behavior/business operations
- `backend/src/services` — shared domains such as storage, notifications, blocks, and mediasoup
- `backend/src/middleware` — authentication, uploads, media access
- `backend/src/sockets` — authenticated realtime events
- `frontend/app` — Next.js route segments
- `frontend/components` — reusable UI
- `frontend/lib` — browser API/realtime helpers

## Validation checklist

```powershell
npm run lint --workspace=@instagram-clone/backend
npm run lint --workspace=@instagram-clone/frontend
npm run lint
npm test
npm run build
npm run db:status
Invoke-RestMethod http://localhost:4000/health
```

For E2E:

```powershell
npm run test:e2e
```

The E2E suite expects a live frontend/backend and a disposable PostgreSQL database. Browser call tests also require camera/microphone permissions and a mediasoup RTC port range that the browser can reach.

## Privacy testing

At minimum, test two separate accounts and verify:

- profile editing always uses `/users/me/profile` and `req.user.id`
- pending follow requests appear only for the target user
- a blocked relationship prevents follow/message/call/content access
- a blocked user's media URL cannot be fetched through `/uploads/*`
- blocked accounts appear in Settings → Blocked accounts for the blocker only, and Unblock removes them
- reporting an account/post creates one `Report` row; repeating it returns the existing report; reporting yourself or a post you cannot view is rejected

## Deployment notes

Use HTTPS, strong unique secrets, managed PostgreSQL, object storage/CDN, media scanning/transcoding, and an externally reachable mediasoup host with the configured RTC range. Add TURN when your network topology requires it.
