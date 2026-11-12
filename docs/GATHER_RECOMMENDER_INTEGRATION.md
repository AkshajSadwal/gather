# Gather recommender integration

## Request path

1. Express authenticates the viewer and gathers an eligible catalogue after account visibility, block/mute, archive, recent-impression and negative-affinity checks.
2. With personalization enabled and service URL/token configured, Express sends only opaque Gather IDs plus versioned recommendation feature snapshots and a bounded eligible candidate pool to the private inference API. No credentials, contact data, messages or profile email are sent.
3. The API is expected to run 128-D two-tower retrieval followed by ReelsRankerV2 scoring. Express accepts only unique IDs already present in its eligible pool, then applies creator diversity and hydrates actual Prisma Reel/Post rows.
4. If the service is unset, times out, is unhealthy, or returns `COLD_START`, Express uses `cold_start_v1`. Failures are bounded and logged without tokens or feature snapshots.
5. When personalization is enabled, the response request ID and per-item impression IDs are persisted with feature snapshots and model/provider versions. The feed keeps the existing `{ requestId, modelVersion, items }` fields and adds `provider`.

The current ML service reports `COLD_START`; the Express integration is ready to fail back. Model 1 retrieval and Model 2 scoring are not active until Gather-specific artifact compatibility and runtime implementation are completed. No KuaiRand IDs are accepted: all service results are checked against the Gather candidate pool.

## Local configuration

In the backend environment set:

```dotenv
REELS_RECOMMENDER_ENABLED=true
REELS_RECOMMENDER_URL=http://localhost:8100
REELS_RECOMMENDER_TOKEN=<same local secret configured on the private Python service>
REELS_RECOMMENDER_SCHEMA_FINGERPRINT=cd94509ad053c55cb973f5dea69546900e3c6d35fc15e90d7308fdbfb46ab82a
REELS_RECOMMENDER_TIMEOUT_MS=1200
```

The URL uses `localhost`; do not bind the service to a public interface. The service URL and token are optional for feed operation. If absent, Gather runs the explicit cold-start provider.

See `RECOMMENDATION_EVENT_TAXONOMY.md`, `RECOMMENDATION_EVENT_SCHEMA.md`, `RECOMMENDATION_TRAINING_PIPELINE.md`, `RECOMMENDATION_OPERATIONS.md`, and `RECOMMENDATION_MODEL_COMPATIBILITY.md` for the data contract and current readiness limits.
