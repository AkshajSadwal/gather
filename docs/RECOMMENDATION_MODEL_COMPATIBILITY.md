# Recommendation model compatibility

The selected KuaiRand checkpoints and retrieval index are references only. See `A:\reels-recommender-m4\docs\GATHER_MODEL_COMPATIBILITY.md` for the source contracts and compatibility matrix. User/reel/creator vocabularies, categorical meanings, numeric distributions and labels are dataset-specific. No weight transfer is approved. The 128-D tower width is a shape match only. The Model 2 watch target is `log1p(seconds)` and requires `expm1` to return seconds.

Gather is `NOT_READY` for both learned stages until first-party features and labels exist, Gather-specific mappings and temporal splits are built, checkpoint and index fingerprints match, and retrieval/ranking evaluation passes. The API must continue to return `cold_start_v1` until then.
