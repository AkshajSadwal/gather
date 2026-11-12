# Recommendation event schema

`ReelEvent.eventId` is a unique idempotency key. `ReelEvent.userId` comes from the authenticated session. `impressionId` must belong to that user and reel. Request attribution is derived from the owned `ReelImpression`, never trusted from client input. `occurredAt` is clamped around server time; `receivedAt` is server-assigned. `schemaVersion` defaults to `gather-events-v1`. The event payload is bounded by the Zod schema and stores only visibility/playback counters and optional position.

`RecommendationRequest.id` is the request ID returned to the client and is related to served impressions. It stores authenticated user, session, cursor, item count, provider, feature schema, model versions, latency, and status. Legacy request IDs are backfilled as `legacy-r5` telemetry in migration `20261117000000_two_stage_recommendations` before the impression foreign key is added.

`ReelImpression` means response delivery. `seenAt`/`IMPRESSION_VIEWABLE` records a viewability event; `WATCH_START` and bounded `WATCH_PROGRESS` measure playback; `WATCH_END` flushes final counters. Current UI threshold is at least 60% intersection for one second. Playback deltas use observed video `currentTime`, only while unpaused and visible. Repeated event IDs are deduplicated by the database unique constraint.

Feature snapshots are JSON for schema-versioned point-in-time inputs. Important selection columns remain relational and indexed. User deletion cascades recommendation requests, impressions, events, affinities, and features. Reset removes recommendation history through the existing reset endpoint. Retention is controlled by `RECO_EVENT_RETENTION_DAYS`.
