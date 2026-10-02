# Follow-up work

## Before a public deployment

- Configure Google OAuth and validate the real two-browser mediasoup voice/video flow over HTTPS.
- Add TURN credentials and verify restrictive NAT/firewall paths.
- Move local uploads to an S3-compatible/object-storage adapter and add CDN delivery.
- Add malware scanning, deeper media codec/signature validation, transcoding, thumbnails, quotas, and cleanup jobs.
- Add email verification, account recovery, and a documented password/session policy.
- Build moderator tooling on top of the `Report` table: an admin role, a review queue, status changes, content takedown, and repeat-offender handling. Add reporter-facing outcome notices and an abuse-response path/SLA.
- Add distributed Socket.IO/presence/call coordination before running multiple backend instances.
- Add rate-limit state shared across instances when distributed deployment is introduced.

## Product improvements

- Extend reporting to comments, stories, reels, and direct messages.
- Add richer privacy controls for who can message, mention, or interact with an account.
- Add message delivery reliability when a browser is offline for an extended period.
- Add stronger feed/reel ranking and media preloading when real traffic requires it.
- Add broader Playwright coverage for desktop/mobile and real device media behavior.
