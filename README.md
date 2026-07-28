# Geospatial platform

A Docker-first, reusable geospatial platform: PostGIS + DuckDB/GeoParquet
ETL, Martin (dynamic vector tiles) + PMTiles (static), a MapLibre GL
Vite+React SPA, FastAPI (public read + auth-gated admin), Celery/Redis
background jobs, and self-hosted OSM basemap tiles behind Caddy. Built in
phases; see `geospatial-stack-build-brief-v3.md` for the full plan of
record (mission, architecture, data model, security defaults, roadmap).

## Quick start (local Docker)

```
cp .env.example .env      # or scripts/bootstrap-new-deployment.sh for a new deployment, see below
docker compose up -d
docker compose exec api python -m app.create_admin <email> <password>
```

Public site: `http://localhost:8080` (via Caddy). Admin: `/admin/login`.
API docs: `http://localhost:8000/docs`. Flower (Celery): `:5555`. Grafana:
`:3001` (local dev only, see `docker-compose.override.yml`).

## What's built

- **Phase 0-1**: ingest → curate → publish pipeline (DuckDB validation,
  PostGIS `published` tier, Martin + PMTiles), public map site with
  filters/search/side-panel/shareable URLs.
- **Phase 2**: R2-portable object storage, backups + tested restores,
  observability (Prometheus/Grafana/Sentry), CI.
- **Phase 3**: JWT auth (`viewer`/`admin`), live styling (draft → publish),
  dataset governance editing, audit trail.
- **Phase 4**: self-service upload → validate → curator-approve → publish,
  and Map authoring (named layer configs with a public shareable route).
- **Phase 5**: this deployment is reusable for a *new* deployment without
  a rewrite -- see [`docs/reuse.md`](docs/reuse.md) for exactly what to
  change and `scripts/bootstrap-new-deployment.sh` to automate the
  mechanical part of it.

## Docs

- [`docs/deploy.md`](docs/deploy.md) -- VPS deployment runbook (not yet executed against a real host).
- [`docs/backups.md`](docs/backups.md) -- backup/restore procedure.
- [`docs/r2-portability.md`](docs/r2-portability.md) -- switching object storage providers.
- [`docs/reuse.md`](docs/reuse.md) -- standing up a new deployment from this codebase.
