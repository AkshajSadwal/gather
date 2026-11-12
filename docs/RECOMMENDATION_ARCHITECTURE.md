# Gather recommendation architecture

## Production contract

The target provider is `two_stage_v1`: Model 1 retrieves Gather reels, then Model 2 ranks eligible Gather candidates. Until compatible Gather artifacts exist, it must return through the explicit `cold_start_v1` provider. The selected KuaiRand checkpoints and index are reference-only and must never be served to Gather users.

## Model 1 reference contract

The selected reference is `TwoTowerRetrieval v3 (pool softmax)`: independent `512 -> 256 -> 128` user and video towers, L2-normalized outputs, and dot-product similarity (cosine similarity after normalization). Its input schema is 36 categorical plus 10 standardized numeric fields. The user tower takes categorical columns `user_id`, `tab`, and the 26 `user:` fields; its numeric columns are `hour_sin_utc`, `hour_cos_utc`, then log1p follow/fan/friend/register counts. The video tower takes `video_id` plus the 7 `video:` fields and numeric `log1p_video_duration_seconds`, `log1p_video_width`, `log1p_video_height`. It excludes time-dependent `log1p_video_age_hours` from cached item vectors. Categorical field order and sizes come from prepared metadata; ID vocabularies are train-split indices with OOV 0.

The matching index metadata records embedding dimension 128, float16 `.npy` vectors, L2 normalization, checkpoint SHA-256, catalogue map SHA-256 and data fingerprint `7bbaadb7410036832014bdf7f3a225671f84bf60c8226c2f98ae78ca5ebb67e7`. Vector rows align with the separate KuaiRand video-ID array. Build writes vectors in batches to a memory-mapped file; retrieval reads chunks (default 131072 rows), computes `vectors @ user_vector`, and uses partial top-K selection. Checkpoint hash, data fingerprint and catalog map hash must match. The index contains KuaiRand IDs and must never be queried by Gather or returned to the app.

Verified with `A:\reels-recommender-m4\.venv\Scripts\python.exe` and `torch.load(..., map_location="cpu")`: Model 1 checkpoint keys include the architecture parameters, 36 categorical sizes, data/prepared fingerprints and state dict; its tower state shapes confirm 128-D output and first layers `[512,159]` (user) and `[512,60]` (video). Model 2 checkpoint keys confirm ten binary outputs, ten numeric inputs and 36 categories; its state shapes include `[512,257]` shared input, `[10,128]` action head and `[1,128]` watch head. Only tensor names and shapes were printed, never tensor values. Both selected checkpoints report dataset `1k`; the interpreter reports PyTorch 2.15.0+cu134 and CUDA available on an NVIDIA GeForce RTX 3050 6GB Laptop GPU. The application still must validate schema, vocabulary, checkpoint hash, catalog map hash, output dimension and normalization before any Gather artifact is loaded.

The common KuaiRand categorical-size vector is `[1001, 3929860, 16, 8, 2, 3, 3, 9, 9, 8, 8, 3, 8, 24, 395, 15, 6, 4, 38, 284, 8, 6, 4, 4, 4, 4, 4, 4, 4, 1300015, 4, 33, 5, 2370635, 8, 1166]` in the documented feature order; sizes include each embedding table's OOV row. Model 1 and Model 2 data/schema fingerprint is `7bbaadb7410036832014bdf7f3a225671f84bf60c8226c2f98ae78ca5ebb67e7`; prepared-data fingerprint is `a9e0107ff2818fba39e378746664cf1a1e70402af11ca0e62d85097c2da1195f`. Model 1 SHA-256 is `6f3114de877b4c2a3770b750704bb0cae6e0a7e2441b6ac7e17ee1162946888e`. The matching index has 4,371,868 vectors, 128 dimensions, float16 L2-normalized vectors, matching checkpoint SHA, and catalog-map SHA `c697b74cd785d253a3c73378110f3580eec0ccdf2b165f9be26b9e53c8f58a54`. Model 2 SHA-256 is `a4c91097fd409145253e9f43454b80852018286e9da5c26b870a75872d47ba8e`; it is a KuaiRand warm-start baseline at epoch 1.

## Model 2 reference contract

The selected reference metadata declares ReelsRankerV2 with shared layers `512-256-128`, 36 categorical fields, 10 numerical fields, 32-dimensional categorical embeddings, ten binary heads in this order: `is_click`, `is_like`, `is_follow`, `is_comment`, `is_forward`, `is_hate`, `long_view`, `is_profile_enter`, `complete_view`, `short_view`, plus a watch-time regression head. The first ranking objective for Gather is the `is_like` head. Treat its output as a score, not a calibrated probability.

Categorical fields: `user_id`, `video_id`, `tab`; user fields `user_active_degree`, `is_lowactive_period`, `is_live_streamer`, `is_video_author`, `follow_user_num_range`, `fans_user_num_range`, `friend_user_num_range`, `register_days_range`, `onehot_feat0` through `onehot_feat17`; video fields `author_id`, `video_type`, `upload_type`, `visible_status`, `music_id`, `music_type`, `tag`. IDs are train-split integer vocab indices with OOV 0. Entity categorical missing values map to `__MISSING__`; unknown categories map to 0.

Numerical order: `log1p_video_duration_seconds`, `hour_sin_utc`, `hour_cos_utc`, `log1p_user_follow_count`, `log1p_user_fan_count`, `log1p_user_friend_count`, `log1p_user_register_days`, `log1p_video_age_hours`, `log1p_video_width`, `log1p_video_height`. Values are standardized with training-split means and standard deviations; invalid/zero standard deviations become 1.

Targets use the actual prepared labels: click/like/follow/comment/forward/hate/long_view/profile_enter; `complete_view` means positive duration and play time at least duration; `short_view` means positive duration and play time below `min(3000 ms, duration)`. Watch time is `log1p(play_time_ms / 1000)`; inverse is `expm1(max(prediction, 0))` seconds. The existing binary outputs are not documented as calibrated probabilities. Positive-class weighting is used by the source training path; exact per-head weights are run-config dependent.

## Transfer compatibility matrix

| Feature | KuaiRand reference | Gather source | Compatible? | Action |
|---|---|---|---|---|
| User/reel IDs | KuaiRand integer vocabularies | Opaque CUIDs | No | Rebuild mappings and ID embeddings |
| Creator IDs | KuaiRand author map | Gather account CUID | No | Build Gather creator features |
| 36 categoricals | KuaiRand ordered schema | Not the Gather event/catalog schema | No | Define one Gather manifest and retrain heads/embeddings |
| 10 numerics | KuaiRand distributions/statistics | Gather measurements/distributions | No | Fit Gather transforms from temporal training split |
| Binary labels | KuaiRand target definitions | Gather events have different semantics | Partial at best | Use explicit versioned mappings and Gather training |
| Watch time | log1p seconds | Gather can measure actual playback seconds | Semantics can align | Train Gather head; inverse only with expm1 |
| 128-D tower output | Shared vector size | Desired Gather architecture | Shape only | Reinitialize/train with Gather IDs and examples |
| Index | KuaiRand IDs and maps | Gather reel IDs | No | Build a new Gather index tied to Gather checkpoint |
| Checkpoint/data fingerprint | KuaiRand run fingerprint | Gather dataset fingerprint | No | Preserve provenance; never rewrite fingerprints |

No layers are approved for weight transfer at this stage. Matching tensor shapes do not establish semantic compatibility. No selected reference checkpoint or index is production-ready for Gather.

## Readiness gate

A service may report `READY` only after validating a Gather model manifest, feature schema fingerprint, Gather vocabulary, checkpoint SHA-256, index/catalog fingerprint, index normalization and output dimension. Otherwise it reports `COLD_START`, `DEGRADED` or `UNAVAILABLE` and Gather uses `cold_start_v1`.

### Ranking output and loss details

The ranker emits logits and inference applies sigmoid to each binary head. The KuaiRand source training loss uses per-batch `pos_weight = clamp(negatives / max(positives, 1), 1, 20)` with binary cross entropy with logits plus `0.20 * smooth_l1` watch loss. KuaiRand's old score combines multiple weighted heads; Gather's initial learned score is the `is_like` head only. Neither the logits nor sigmoid outputs are assumed calibrated.

## Gather feature adapter and two-stage serving update

Gather now creates point-in-time user/reel snapshots using `gather-reco-v1`. CUIDs are SHA-256 pseudonyms before export or inference; the dataset adapter fits each categorical vocabulary and numeric imputation/mean/std on chronological training rows only. OOV/missing categories use index 0. Arrays preserve the manifest's 36-category and 10-numeric order, label availability masks, and `log1p(playback_seconds)` watch targets. The feature generator refuses non-empty output directories and never bypasses readiness thresholds.

`ReelRecoFeatures` refreshes in 500-row batches alongside user aggregates at startup and on `RECO_FEATURES_INTERVAL_MS`. Event/impression retention remains `RECO_EVENT_RETENTION_DAYS`; account deletion/reset cascades the viewer-owned rows. The ML evaluator reports masked `is_like` ranking AUC, watch-log MAE, and full-index Recall@100. Promotion requires a separately invoked explicit approval command and matching artifact hashes. No model is promoted automatically.

The persistent private service loads only Gather checkpoints, their prepared-data metadata, mappings, and the matching retrieval index. It retrieves across the entire index, then ranks only current backend-supplied privacy-eligible candidates. This intersection preserves Gather authorization and moderation rules; it can return fewer than the requested count. Missing or mismatched artifacts leave readiness at `COLD_START` and the backend uses `cold_start_v1`. KuaiRand weights are never used for Gather.
