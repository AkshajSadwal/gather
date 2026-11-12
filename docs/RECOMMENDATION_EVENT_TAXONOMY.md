# Recommendation event taxonomy

Event IDs are client-generated idempotency keys. Each event is authenticated as the session user; the server derives creator IDs and validates that the owned impression matches both user and reel. Client timestamps are clamped to the past 24 hours / future 5 minutes. Do not treat delivery of a reel in a response as a view.

| Event | Meaning | Training interpretation |
|---|---|---|
| `IMPRESSION_VISIBLE` | Legacy visibility event | Compatibility alias; visibility only |
| `IMPRESSION_VIEWABLE` | Reel met the UI viewability threshold | Exposure, never a negative label by itself |
| `WATCH_START` | Playback began | Exposure/play-start context |
| `WATCH_PROGRESS` | Periodic playback-time delta | Accumulate bounded actual playback duration |
| `WATCH_END` | Viewer stopped/left; final counters | Compatibility final playback summary |
| `WATCH_COMPLETE` | Playback completed | Positive completion label only with measured duration |
| `REPLAY` | A subsequent playback pass | Weak positive engagement |
| `LIKE`, `UNLIKE` | Like state transition | Positive/label correction |
| `SAVE`, `UNSAVE` | Saved-post state transition | Positive/label correction |
| `SHARE`, `COMMENT` | Share/comment action | Positive engagement |
| `CREATOR_FOLLOW`, `CREATOR_UNFOLLOW` | Follow state transition | Positive/label correction |
| `PROFILE_OPEN` | Creator profile opened | Weak positive engagement |
| `NOT_INTERESTED` | Explicit negative feedback | Strong negative preference |
| `REPORT` / `REPORT_REEL` | Safety report | Moderation signal; not a preference label |
| `CREATOR_BLOCK`, `CREATOR_MUTE` | Safety/preference control | Exclude creator; do not treat as ordinary watch label |

`short_view` is weak negative evidence only after a viewable exposure and measured playback; unseen reels are never negatives. Gather `complete_view` uses the current event threshold of at least 90% of known positive duration; the KuaiRand reference label used at least the full duration, so this is a separately versioned Gather definition. Model 2 targets without defensible Gather semantics remain unavailable until a later label schema defines them. Watch time is stored in milliseconds and exported as `log1p(seconds)` for a Gather-trained ranker.

The current frontend already sends the legacy visible and final watch events. New lifecycle types are accepted by the API for incremental client rollout. A per-frame event is prohibited; progress should be periodic and idempotent.
