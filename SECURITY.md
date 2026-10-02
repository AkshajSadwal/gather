# Security notes

This document describes the current application-level security model. It is a development baseline, not a substitute for deployment security, abuse operations, privacy policy, or legal review.

## Identity

- Auth.js is the browser session authority.
- Express and Socket.IO derive the authenticated identity from the verified Auth.js session cookie.
- The backend must use `req.user.id` as the owner identity for mutations.
- Client-supplied `userId`, username, post ownership, conversation membership, or mediasoup resource IDs are never authoritative.

## Authorization

Every protected mutation checks the authenticated user and the resource owner/member relationship on the server.

Profile edits and avatar uploads only target the authenticated user. Follow-request acceptance only targets requests where `followedId` equals the current user. Message and call actions require conversation/call membership.

## Blocks

The `Block` model establishes a server-side interaction boundary. Creating a block removes both existing follow edges between the pair. Future follow, message, call, post/story/reel/media access and relevant discovery are rejected or filtered across the blocked boundary. Unblocking does not recreate the former follow relationship.

## Reports

`POST /api/reports` requires a session and is rate-limited (20/hour). Reporter identity always comes from `req.user.id`, never the payload. Post reports run the same visibility/block check as reading the post, so a report cannot be used to confirm the existence or content of a private post. Reporters are never exposed to the reported account, and open duplicate reports from one reporter for one target are collapsed. A database `CHECK` prevents self-reports as defense in depth. Report records can contain sensitive free text; restrict database access accordingly and apply your retention policy.

## Input and upload protection

Zod validates structured API and Socket.IO payloads. Uploads are limited by MIME type, file signature, count and size. Files are first written to a temporary random filename, then moved into the upload directory after validation. Uploaded paths are served only through authorization checks.

## Rate limits

Authentication, username/email availability checks, and write operations have route-level rate limits. Socket messaging also has an in-memory per-user sending window. A production multi-instance deployment needs a shared rate-limit store.

## Session and secrets

`AUTH_SECRET` and `INTERNAL_AUTH_SECRET` must be independent, random server-only values. `.env` is ignored by Git. Google OAuth credentials and mediasoup public-network settings must never be committed as secrets.

## Current limits

The app still needs deployment-level hardening such as HTTPS, a managed database, object-storage permissions, malware scanning, media processing, TURN configuration, shared realtime state for scale-out, and operational moderation/reporting.
