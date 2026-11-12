# Recommendation operations

## Current state

Provider target: `two_stage_v1`. Actual response provider remains `cold_start_v1` until a Gather model/index runtime is validated. `GET /health/live` checks process liveness; `GET /health/ready` reports readiness. The current Python service always returns `COLD_START`. Express times out after at most five seconds (default 1200 ms), opens a short circuit after three failures, filters all returned IDs against eligible Gather reels, and logs only a short failure category.

## Local PowerShell setup

From `A:\reels-recommender-m4`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-serving.txt
$env:REELS_RECOMMENDER_TOKEN = '<local random token>'
uvicorn serving.app:app --host localhost --port 8100 --workers 1
```

Set the same secret, `REELS_RECOMMENDER_URL=http://localhost:8100`, and the fingerprint from `A:\reels-recommender-m4\configs\gather_recommendation_schema_v1.json` in Gather's backend environment. Never commit the token. Production must use a private network and deployment-managed secret storage.

Artifact paths for a future Gather runtime are independently configured in the ML service deployment; current readiness is blocked until the manifest, retrieval/ranking checkpoints and Gather index are produced and validated. Do not point those paths at the selected KuaiRand references.

## Database and backend

From `A:\in\instagram-clone` after reviewing migration SQL:

```powershell
npm run db:generate
npm run db:migrate
npm run dev:backend
```

Do not apply the migration until the expected local database is configured and the reviewed migration has been backed up according to the application's normal process.

## Checks

```powershell
npm run lint --workspace=@instagram-clone/backend
npm run lint --workspace=@instagram-clone/frontend
python -m unittest discover -s tests -p "test_gather_*.py"
```

These checks have not all been run in this session. Do not start training from synthetic fixtures.
