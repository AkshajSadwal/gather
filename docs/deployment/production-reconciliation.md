# Gather production reconciliation

This is a manual preparation guide for the native Ubuntu 24.04 deployment. It does not authorize production access, migration, restart, storage changes, or deployment. Gather and Rauma share the VM; keep every future operation scoped to `/home/ubuntu/gather` and leave Rauma, Nginx, systemd units, cloud networking, and TLS configuration untouched.

## Current local evidence

- The owner-provided importer archive was reviewed as reference source. Its installer and uninstaller were not executed. Gather now contains the permanent route, controller, upload middleware, service, Python ZIP helper, admin page, and navigation entry.
- Import job JSON and pending ZIP files retain `uploads/.bulk-imports/<uuid>.json` and `<uuid>.zip`. The service reads the prior job fields and resumes queued or interrupted jobs. Retries use the original archive and retain the target account.
- The importer stores canonical `s3://<bucket>/bulk-imports/<user-id>/...` references and matching `objectKey` fields. Mocked tests confirm the OCI-compatible reference format; no production database or object was inspected or changed here.
- Jobs and pending archives use the existing persistent upload filesystem. Importer integration has no Prisma schema change or migration. It does not rewrite or delete existing Post/Reel rows or media objects.
- The local frontend production build passes with filesystem access to Next.js standalone tracing. The target ARM64 Linux build and custom production launcher still need verification before deployment.
- The repository contains two tracked database dump files. They are pre-existing and were not inspected; treat them as potentially sensitive until privately reviewed.

## Reconciliation sequence

1. **Freeze and inventory.** Do not run `/home/ubuntu/deploy-both.sh` or either temporary importer script. Confirm with the administrator that no import is active or queued. Record Gather's working-tree state and importer changes without printing environment values or private user data.
2. **Back up VM state.** Make a restricted, verified backup of the Gather working-tree diff, untracked importer source, production `backend/src/server.js`, and `frontend/start-production.cjs`. Store it outside the checkout with access limited to the deployment administrator. Exclude `.env`, credentials, uploads, and object data from source archives; back up sensitive configuration separately through approved secret management.
3. **Compare importer implementations.** Compare the permanent code with the temporary route, app mount, AppShell changes, scripts, job JSON, and pending ZIPs. Never execute the archive's installer or uninstaller. Do not restore stale `app.js` or `AppShell.jsx` backups.
4. **Preserve durable state.** Back up and retain `/home/ubuntu/gather/uploads/.bulk-imports`, including job JSON and pending ZIPs. Verify no job is active before switching source. Preserve the existing approximately 384 imported posts and their `bulk-imports/<user-id>/posts|reels/<sha256>.<ext>` OCI objects. Do not delete or re-import media to test compatibility.
5. **Reconcile source carefully.** Apply only reviewed Gather changes. Preserve moderation routes, current admin checks, UI, Reels, feed, comments, privacy fixes, and the production-only launcher/server behavior. Do not run `uninstall.sh`; it restores stale files and deletes importer code. The permanent service retains the existing object prefixes and job format.
6. **Preserve production startup.** Keep the backend bound to `127.0.0.1:4100` behind Nginx and retain `frontend/start-production.cjs` with the frontend bound to `127.0.0.1:3100`. Do not copy local `server.js` or generic Next.js startup changes over these production files.
7. **Confirm admin access.** Keep backend authorization on every account-list, upload, job-list, detail, and retry endpoint. Confirm `ADMIN_USERNAMES` still lists the intended administrators. Test unauthorized and non-admin requests before exposing the route; hidden navigation is not authorization.
8. **Confirm OCI media compatibility.** Keep the private `gather-media` bucket and legacy `MINIO_*` configuration names. For existing imported rows, use read-only checks to compare `url`, `objectKey`, MIME type, and OCI object metadata. Record only request success, content type, and content length. Never log credentials, full signed URLs, or private media.
9. **Review migrations.** The permanent importer itself has no migration. Confirm this against the exact deployed revision. Review any unrelated schema changes separately; back up PostgreSQL 16 and rehearse approved migrations against a disposable copy. Never reset the production database or migrate while an import is active.
10. **Build and verify Gather alone.** Build on Linux matching the ARM64 VM and verify static assets plus the custom launcher. Test admin access, upload limits, archive validation, duplicate/retry behavior, restart recovery, and signed media delivery. Confirm Python 3 and `ADMIN_USERNAMES` are configured. Verify privacy filtering with the recommender enabled and disabled.
11. **Prepare rollback.** Keep the pre-change checkout backup, production launcher, approved database backup, and importer job state until verification is complete. Roll back Gather code only. Do not delete referenced OCI objects, job JSON, pending ZIPs, or restore stale app backups. Any database rollback must follow the reviewed backup plan; never improvise destructive SQL.
12. **Make deployment tooling safe.** Do not use `/home/ubuntu/deploy-both.sh` to deploy Gather. Before using it again, have its owner add and review a Gather-only mode that cannot pull, overwrite, restart, or change Rauma, then test that mode against a disposable checkout. Reconcile VM-only changes into reviewed source first; never use reset, clean, or force operations to make the script proceed.

## Read-only thumbnail diagnostics

Run these checks manually on the VM with the approved database client and OCI credentials. Keep results private and redact account identifiers before sharing:

- Compare a broken media row's `url`, `objectKey`, and MIME type with a working row. The URL must use the configured bucket and exact stored key.
- Use `HeadObject` for the private OCI object and inspect only existence, content type, content length, and last-modified time.
- Request the app's signed-media endpoint as an authorized viewer and confirm it redirects. Do not paste the signed URL into tickets or logs.
- If the object exists but the app returns `MEDIA_NOT_FOUND`, compare the database URL with the request reference. If the redirect succeeds but the client cannot load the object, verify the public signing endpoint and OCI-compatible signature.
- Compare PostMedia and ReelMedia references separately; one does not prove the other is correct.

Do not re-import, overwrite, or delete a production object to test these hypotheses.

## Public database backup exposure

The [public Gather repository](https://github.com/AkshajSadwal/gather) contains `gather-old.dump` and `gather-k8s-before-restore.dump` in its existing history. Their contents were not inspected in this merge-resolution work. Treat them as potentially exposed until privately reviewed. The repository owner should restrict access, preserve a controlled copy, inspect the dumps in an isolated environment, rotate any credentials found, invalidate affected sessions/tokens, assess user-data exposure and notification duties, and remove the dumps from published history through an approved repository process. Do not rewrite history, delete backups, or rotate credentials as part of this merge.
