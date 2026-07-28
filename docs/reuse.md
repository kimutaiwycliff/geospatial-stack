# Reusing this platform for a new deployment (brief §17 Phase 5)

**What this is:** a checklist for standing up a *second, independent*
instance of this platform -- a different client, different data, different
domain -- from this same codebase, without disturbing the deployment
that's already running from it.

**What this is not:** a cookiecutter/degit template repo with `{{ }}`
placeholders. The brief's Phase 5 names cookiecutter/degit as example
mechanisms; the actual bar is "a new deployment stands up in hours." This
codebase already gets most of the way there on its own, because Phases 0-2
built it env-driven and provider-portable from the start (brief §7 "env-based
config end to end"; §2's S3-only object-storage rule) -- what was still
missing was (a) a way for a fresh clone to know exactly what to change, and
(b) getting this deployment's example/seed content out of pipeline *code*
and into one clearly-labeled *data* file, so removing it doesn't mean
editing task logic. Both are addressed below. A literal parameterized
template package was deliberately not built: this repo is a real, running
deployment, not a public starter kit, and genericizing its actual content
(copy, branding, example data) in place would degrade the live product for
no one's benefit. If a genuinely separate public template repo is wanted
later, treat this document as its source material.

## What's already reusable, unchanged

- **The whole pipeline** (ingest → curate → contract-test → load PostGIS →
  tile) is dataset-agnostic -- see `api/worker/tasks.py`'s task functions.
  Nothing there hardcodes a dataset's shape; everything dataset-specific
  either comes from the uploaded file itself or from config (see below).
- **Self-service upload + Map authoring (Phase 4, brief §16)** means a new
  deployment can start receiving real geometry data through the admin UI
  from day one -- no code changes, no per-dataset dict entry, at all. The
  engineer-triggered CLI path (`worker/dispatch_cli.py`) still exists for
  bulk/scripted loads, but it's optional now, not the only way in.
- **Object storage** is provider-portable already (`docs/r2-portability.md`):
  five env vars (`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`/
  `S3_REGION`) pick MinIO (default, self-hosted) or Cloudflare R2 with zero
  code changes.
- **Auth, styling, governance, audit** (Phase 3) and **Maps** (Phase 4) are
  all generic registry/config machinery -- nothing in `api/app/` is
  LandMark-specific.
- **The basemap** (`basemap/build_basemap.py`) is already world-scope, not
  region-locked -- no change needed for a deployment covering a different
  part of the world.

## What a new deployment needs to change

1. **Env identity** -- copy `.env.example` to `.env` and pick new values for
   at minimum: `POSTGRES_DB`, `S3_BUCKET`, `JWT_SECRET` (generate a real one:
   `openssl rand -hex 32`), `GRAFANA_ADMIN_PASSWORD`, and
   `API_CORS_ORIGINS`/whatever domain(s) the new deployment will actually
   run behind. `scripts/bootstrap-new-deployment.sh` (below) automates the
   mechanical parts of this step.

2. **Example seed data** -- `api/worker/seed_datasets.py` holds every
   dataset this deployment's engineer-triggered CLI path was hand-loaded
   with (`DATASET_META`, `TABULAR_DATASET_META`): real LandMark datasets
   plus one disposable Kenya fixture. **Delete the entries** (or the whole
   file's contents, leaving empty dicts) unless the new deployment
   specifically wants to bulk-load its own data the same way -- in which
   case replace the entries with that deployment's own datasets, following
   the same shape. This is now a one-file, config-only change; no pipeline
   code needs editing either way. If the new deployment is only ever going
   to receive data through the self-service upload UI (Phase 4), this file
   can just stay empty.

3. **Fixture/reference data on disk** -- delete `data/landmark/` (the real
   LandMark downloads, under that access grant's terms, not transferable to
   a different deployment/client) and `data/stand_in/` (the Kenya fixture,
   only ever useful for proving the pipeline works, which it already has).

4. **Country-summary view** -- `api/worker/tabular_tasks.py`'s
   `build_country_summary_view_task` joins four specific LandMark tabular
   datasets by a hardcoded table-name mapping (`view_tables` inside that
   function). This is bespoke Horizon-1 business logic, not a generic
   pipeline primitive -- a new deployment almost certainly doesn't need this
   task at all unless it happens to have the exact same four-table shape of
   per-country indicator data. Leave it uncalled (nothing in `run_pipeline`
   chains it automatically) rather than trying to generalize it.

5. **Frontend copy** -- `web/src/components/Landing.tsx` (and any other
   copy referencing "LandMark") is this deployment's actual homepage text.
   A new deployment writes its own.

6. **First admin account** -- there is no signup route by design (brief
   §10). Once the new deployment's compose stack is up:
   `docker compose exec api python -m app.create_admin <email> <password>`.

7. **VPS deploy, if/when going beyond local Docker** -- follow
   `docs/deploy.md` against the new deployment's own host; nothing in it is
   specific to the LandMark content, only to "a" VPS.

## What almost certainly does NOT need to change

Migrations (`db/migrations/`), the API routers, the worker task functions
themselves, the observability stack (`ops/`), backup scripts (`ops/backup/`),
CI (`.github/workflows/ci.yml`), and every frontend component under
`web/src/components/` other than `Landing.tsx`'s copy. If you find yourself
editing one of these for a "new deployment," stop and check whether the
change actually belongs in one of the seven items above instead -- the
whole point of Phases 0-4's design was to keep exactly these pieces generic.
