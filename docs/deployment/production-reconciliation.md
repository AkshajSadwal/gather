# Gather production reconciliation

This is a manual preparation guide for the native Ubuntu 24.04 deployment. It does not authorize a production migration, restart, storage change, or deployment. Gather and Rauma share the VM; keep every step scoped to `/home/ubuntu/gather` and leave Rauma, Nginx, systemd units, and cloud configuration untouched.

## Current local evidence

- The owner-provided importer archive is now available and was reviewed as reference source. Its installer and uninstaller were not executed. The Gather checkout includes the permanent route, controller, upload middleware, service, Python ZIP helper, admin page and navigation entry.
- Import job JSON files and pending ZIPs retain the temporary importer's `uploads/.bulk-imports/<uuid>.json` and `<uuid>.zip` paths. New code reads the prior job fields and resumes queued or interrupted jobs; retry jobs use the original ZIP and preserve the target account.
- Visible app branding, page metadata, and README identify the product as Gather. The old npm workspace names and local checkout path remain internal compatibility identifiers; changing them would also require coordinated script/lockfile updates.
- The local code supports private S3-compatible media references in the form `s3://<bucket>/<key>`. A media request resolves the exact stored URL through the database, applies visibility checks, and redirects to a signed object URL.
- The `bulk-imports/<user-id>/posts/` and `bulk-imports/<user-id>/reels/` key prefixes are accepted by the local object-key validator. The importer must still store matching canonical S3 references in media rows; this cannot be confirmed without its source and records.
- The permanent importer uses atomically replaced, permission-restricted JSON job files on the existing persistent upload filesystem. No Prisma schema change or migration is required. Existing Post/Reel rows and OCI objects are not rewritten by the code integration.
- Local builds compile, but Windows standalone tracing ended with `EPERM`. Validate the production standalone build on the target Linux environment before scheduling a deployment.

## Reconciliation sequence

1. **Freeze and inventory.** Do not run `/home/ubuntu/deploy-both.sh` or either temporary importer script. Confirm with the administrator that no import is running or queued. Record the Gather working-tree status and all modified and untracked importer files without printing environment values or private user data.

2. **Back up the VM state.** Make a restricted, verified backup of the Gather working-tree diff, untracked importer source, production `backend/src/server.js`, and `frontend/start-production.cjs`. Store it outside the checkout with permissions limited to the deployment administrator. Exclude `.env`, credentials, uploads, and object data from ordinary source archives; back up sensitive configuration separately through the approved secret-management process.

3. **Review the importer archive.** The owner-provided ZIP has been safely inspected locally; its installation scripts remain untrusted reference files and were not run. On the VM, compare its temporary route, app mount, AppShell changes, scripts, and job files with the permanent Gather code before replacing anything.

4. **Preserve durable state.** Back up and retain `/home/ubuntu/gather/uploads/.bulk-imports` (including JSON jobs and any pending ZIPs), and verify no job is active before switching source. Keep the existing 384 imported posts and their `bulk-imports/<user-id>/posts|reels/<sha256>.<ext>` OCI objects. No database migration is part of the permanent importer; do not delete or re-import media to validate compatibility.

5. **Reconcile source carefully.** Merge only the permanent importer files and their route/navigation additions into the VM checkout. Preserve report moderation, admin authorization, current UI, Reels, feed, comments, privacy fixes, and the previous production-only launcher/server behavior. Do not restore stale `app.js` or `AppShell.jsx` backups. Do not run `uninstall.sh`: it restores those stale files and deletes the temporary importer source. The permanent service keeps the existing object-key prefixes and JSON job-file format.

6. **Preserve production-only startup behavior.** Keep the backend bound to `127.0.0.1:4100` behind Nginx and retain `frontend/start-production.cjs` and the `127.0.0.1:3100` frontend service. Do not copy local `server.js` or generic Next.js startup changes over these production versions.

7. **Confirm admin access.** Keep backend authorization on every account, upload, job, detail, and retry endpoint. Confirm the existing `ADMIN_USERNAMES` configuration still resolves the intended admins. Test unauthorized and non-admin requests before exposing the route; a hidden navigation entry is not authorization.

8. **Confirm OCI storage compatibility.** Keep the private `gather-media` bucket and existing `MINIO_*` configuration names. For an imported row, privately verify that `url` is the canonical `s3://gather-media/bulk-imports/<user-id>/...` reference and that `objectKey` matches the stored object. Use an OCI `HeadObject` check with protected runtime credentials; record only HTTP success, content type, and content length. Never log credentials, full signed URLs, or private media.

9. **Review migrations.** The permanent importer makes no Prisma schema changes and has no migration command. Confirm this against the exact deployed revision before rollout; do not run a migration for the importer. If unrelated schema changes are present in that revision, review them separately and never migrate while an import is active.

10. **Build and verify Gather alone.** Run the documented standalone build on a Linux environment matching the ARM64 VM, verify static assets and the custom launcher, then test admin authorization, upload limits, archive validation, duplicate/retry behavior, interrupted-job recovery, and signed media delivery. Confirm the Python 3 executable is available to the Gather backend and `ADMIN_USERNAMES` still lists the intended operators. Confirm candidate privacy filters remain enforced with the external recommender on and off.

11. **Prepare rollback.** Keep the pre-change checkout backup, production launcher, database backup, and importer job state until the new route and media have been verified. Roll back Gather code as a scoped Gather-only action. Do not delete referenced OCI objects, importer job JSON, pending ZIPs, or restore stale `app.js`/`AppShell.jsx` backups. No importer database rollback is needed.

12. **Make deployment tooling safe.** The current `/home/ubuntu/deploy-both.sh` has not been inspected locally and updates both applications. Do not run it to deploy Gather. Before using it again, have its owner add and review an explicit Gather-only target that cannot pull, overwrite, restart, or change Rauma, then test that mode against a disposable checkout. Reconcile the VM's uncommitted importer changes into reviewed source first; never use reset, clean, or force operations to make the script proceed.

## Read-only thumbnail diagnostics

Run these checks manually on the VM with the approved database client and OCI credentials. Keep results private and redact user identifiers before sharing them:

- Compare a broken media row's `url`, `objectKey`, and MIME type with a working row from an ordinary upload. The URL must use the configured bucket and the exact key stored in OCI.
- Use `HeadObject` against the private bucket for the exact imported key and inspect only existence, content type, content length, and last-modified time.
- Request the app's signed-media endpoint as an authorized viewer and confirm it returns a redirect. Do not paste the resulting signed URL into tickets or logs.
- If object metadata is correct but the app returns `MEDIA_NOT_FOUND`, inspect whether the database `url` exactly matches the request reference. If the app redirects but the browser cannot load it, verify the configured public signing endpoint is reachable from the client and produces an OCI-compatible signature.
- Compare PostMedia and ReelMedia references separately. A successful post object does not prove the matching ReelMedia row or MIME type is correct.

Do not re-import, overwrite, or delete any production object to test these hypotheses.

## Public database backup exposure

The [public Gather repository](https://github.com/AkshajSadwal/gather) lists `gather-old.dump` and `gather-k8s-before-restore.dump`. Their archive contents were not inspected in this local pass because a PostgreSQL restore/listing tool was unavailable. Treat both files as exposed until reviewed in an isolated environment. The repository owner should restrict public access immediately, preserve a controlled backup, inspect the archives privately, rotate any credentials found, invalidate affected sessions/tokens, assess user-data exposure and notification duties, then remove the archives from published history through an approved repository process. No history rewrite, backup deletion, or credential rotation was performed here.
