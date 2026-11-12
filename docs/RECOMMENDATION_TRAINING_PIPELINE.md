# Recommendation training pipeline

1. Export only impression-linked exposures for users who have personalization enabled and whose impression predates any reset.
2. Export pseudonymous IDs, server-recorded events, labels with explicit availability, and point-in-time user/reel snapshots. Do not join current state into historical examples.
3. Run `scripts/prepare_gather_dataset.py`. It hashes the source, checks minimum users/impressions/positive rows/reel and creator diversity/time coverage, requires snapshots and `gather-labels-v1`, and writes chronological 80/10/10 splits only after every readiness gate passes.
4. Keep clicks unavailable because the existing app does not currently define a defensible click event. `NOT_INTERESTED` is an explicit negative, not a report. Reports remain moderation signals. Gather completion uses the existing 90% playback threshold and is versioned separately from the KuaiRand full-duration label. Watch targets use `log1p(seconds)`.
5. Train only with Gather-specific mappings/fingerprints; evaluate temporally and keep promotion separate. Never overwrite a prior artifact.

Export command from the Gather repository:

```powershell
node backend/scripts/export-reco-training-data.js exports/reco-training.jsonl
```

Preparation command from the ML repository:

```powershell
python scripts/prepare_gather_dataset.py A:\in\instagram-clone\exports\reco-training.jsonl --output-dir data\gather\v1
```

Current readiness remains `NOT_READY`: the live feed does not yet populate complete Gather user/reel feature snapshots and the first-party data thresholds have not been established. Therefore no Gather train, index-build, model-evaluation, or promotion command is currently provided; running KuaiRand scripts on this export would be incorrect. Add those commands only with the Gather-specific adapters and validated manifest.
