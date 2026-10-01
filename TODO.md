# Follow-up work

## Before a public deployment

- Configure Google OAuth credentials and validate one-to-one SFU calls in the deployed same-site HTTPS topology with the mediasoup UDP/TCP port range reachable.
- Move local uploads behind an S3-compatible storage adapter and add background cleanup for expired stories, failed temporary uploads, and deleted media.
- Add malware scanning, more complete media signature/codec validation, image/video processing, CDN cache policy, and upload quotas.
- Add email verification and account recovery; define lockout policy and privacy/legal disclosures.
- Use a shared adapter and distributed presence/call state before running multiple backend instances.

## Product improvements

- Add moderation/reporting, block/mute controls, and stronger content safety workflows.
- Add a dedicated reel comment overlay (comments are available from the linked post detail) and richer account privacy settings.
- Add request throttling keyed by account/IP and automated cleanup/retention policy.
- Add broader end-to-end browser coverage for the main mobile and desktop journeys, including real two-browser mediasoup audio/video negotiation.
