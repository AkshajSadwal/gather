# Gather authentication transition (local preparation only)

## Scope and current limit

`20261118000000_oauth_identity_email_optional/migration.sql` makes `User.email` nullable and adds `OAuthIdentity` with a unique `(provider, providerAccountId)` pair and a cascading `User` foreign key. It does **not** remove or rewrite any existing email value, user ID, password, post, Reel, message, or recommendation record. `User.emailVerified` is also retained. This is the expand stage; dropping the legacy email columns is blocked until legacy Google identities are securely linked and verified. The migration is not a rollback mechanism: reversing it would fail once email-free users exist.

New password accounts register and sign in by username. Existing password accounts continue to use their username and password and keep their IDs. Email sign-in is removed. Email-free accounts cannot recover a forgotten password through email; signed-in password change still works. New Google sign-ins use Auth.js's verified Google provider account ID as the identity key and create a user with no stored email. A returning mapped Google identity gets the same Gather user ID.

Historical Google-only accounts lack a stored Google subject. A matching Google email is **not** sufficient to prove ownership, particularly for reassigned organization addresses. The sync endpoint rejects such a match with `LEGACY_GOOGLE_LINK_REQUIRED` and creates no duplicate. Those users cannot complete a new Google sign-in until a reviewed linking process attaches their verified subject to the existing user ID. Existing browser sessions can remain valid, but must not be treated as proof for an arbitrary new subject. Inventory affected users and design an explicit, audited linking process before production rollout. Never reset or recreate these accounts, and do not drop or clear their email fields to bypass the check.

## Google configuration

The callback is handled by the Next.js Auth.js route `frontend/app/api/auth/[...nextauth]/route.js`, not by Express. Register these exact redirect URIs in Google Cloud:

- Development: `http://localhost:3000/api/auth/callback/google`
- Production: `https://gather.rauma.dpdns.org/api/auth/callback/google`

Use `http://localhost:3000` and `https://gather.rauma.dpdns.org` as the corresponding authorized JavaScript origins. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `INTERNAL_AUTH_SECRET`, `AUTH_URL` or `NEXTAUTH_URL`, `BACKEND_URL`, `FRONTEND_URL`, and `NEXT_PUBLIC_GOOGLE_LOGIN=true` consistently. The Google client secret and both app secrets stay server-side. The public flag only controls button visibility; it does not grant access. Confirm the reverse proxy sends `/api/auth/*` to the Next.js frontend and Gather's other `/api/*` paths to Express, preserving the public HTTPS host. Confirm Auth.js uses secure cookies over HTTPS.

Google OAuth consent configuration cannot be inferred from this repository. Before opening sign-in to all visitors, an administrator must check whether the consent screen is in Testing mode, whether the app is External, the configured test-user list, published status, requested scopes, authorized domain, and Google's applicable verification requirements. A missing or cancelled provider flow should return the visitor to sign-in without creating a Gather account.

## Local verification

Use disposable local PostgreSQL and MinIO only. A representative pre-migration fixture must include a password account with a historical email and a Google-only account with a historical email, each with content. Back up the fixture, apply the migration with Prisma, and verify both IDs, emails, and content counts remain unchanged. Verify username-only signup/login, duplicate username rejection, Google identity first/returning sign-in, the legacy-link rejection, anonymous public Reel discovery, and authenticated recommendation behavior. `tests/auth-guest.integration.test.js` exercises the new DB-backed flows using mocked internal Google sync; live Google OAuth still requires manual testing with local test credentials.

Run `npm run db:generate`, `npm run db:migrate`, `npm test`, `npm run lint`, and `npm run build` locally after configuring disposable services. Test the Google redirect on `localhost`, including cancellation, invalid configuration, returning identity, and a legacy Google-only account. Test password sign-in and password change for an existing credential user. Confirm `/api/auth/me` and Reels access for both account types.

## Gather-only rollout plan (not executed)

1. **Blocker:** finish and security-review a legacy Google-only account-linking procedure. Inventory affected accounts without printing emails or secrets into logs. Confirm every affected user can retain the same Gather ID. Do not deploy the new auth behavior until this is resolved.
2. Make a verified PostgreSQL backup and a rollback plan; preserve existing production media and importer job history. Check migration drift and confirm the added table name does not conflict with production-only changes.
3. Confirm Google consent status, both redirect URIs, public origins, secrets, and the Nginx Auth.js route split. Keep the frontend and backend deployed together because their auth payloads change.
4. Schedule a Gather-only maintenance window. Stop Gather writes, apply the reviewed migration, then deploy matching backend and frontend code. Keep the production-only backend loopback bind and `frontend/start-production.cjs`. Do not use the combined Rauma/Gather deployment script or change Rauma.
5. Check signup, username login, existing password login, Google first/returning login, legacy linking, `/api/auth/me`, private content access, anonymous Reels, and authenticated Reels. Watch 401/409/500 rates without logging tokens or email claims.
6. If rollback is needed, restore a compatible application version and database backup together. Once email-free accounts exist, the old non-null email schema cannot be restored safely by simply reverting code or SQL. Preserve newly created data and plan any rollback explicitly.

The later contract stage may drop `User.email`, `User.emailVerified`, and the old unique index only after all legacy identities are mapped, sign-in continuity is verified, and a separate migration and backup are reviewed. No such destructive migration is included here.
