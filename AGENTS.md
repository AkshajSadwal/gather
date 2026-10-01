# Repository guidance

- Keep the frontend and backend separate. Frontend code is JavaScript/JSX only; backend code is CommonJS JavaScript.
- Use the Prisma schema as the source of truth for persistence. Normalize account names in the backend and rely on PostgreSQL unique indexes for final uniqueness enforcement.
- Do not expose `AUTH_SECRET`, `INTERNAL_AUTH_SECRET`, OAuth secrets, or database credentials in `NEXT_PUBLIC_*` variables.
- Backend routes should authenticate and authorize from the validated Auth.js session cookie. Never trust user IDs or ownership claims from request bodies.
- Keep uploads out of PostgreSQL. Validate MIME and file signatures, use generated filenames, enforce limits, and keep storage behind `services/storage.js`.
- Keep API responses in `{ data }` / `{ error: { code, message } }` form. Put validation and authorization in the backend even when the UI already checks them.
- Use cursor pagination for feeds and message history. Keep Socket.IO for presence, signaling, and message events; mediasoup WebRTC transports carry call media. Never send media through Socket.IO.
- Keep call state and mediasoup resources server-authoritative. Verify the authenticated user, call membership, transport ownership, and producer/consumer ownership on every call event.
- Add schema changes through Prisma migrations. Update `docs/API.md`, `ARCHITECTURE.md`, and `STATUS.md` when behavior or boundaries change.
- Run `npm test`, `npm run lint`, and `npm run build` after implementation changes when the local PostgreSQL service is available.
- Never commit `.env`, real credentials, uploaded files, or generated build artifacts.
