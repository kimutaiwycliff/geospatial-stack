"""Example/seed dataset registrations for the engineer-triggered CLI path
(worker/dispatch_cli.py, run_pipeline) -- THIS FILE, not pipeline logic
elsewhere, is what a new deployment of this platform edits or deletes.

Phase 0-1 built this project's actual site: a LandMark-style replica loaded
with real LandMark data plus one disposable Kenya fixture used to prove the
pipeline end-to-end. Every entry below is specific to THAT content, not to
the pipeline itself -- worker/tasks.py and worker/tabular_tasks.py only
ever read these dicts by key, they don't know or care what's in them.

Phase 4's self-service upload flow (brief §16) needs NONE of this: a
curator uploads a file through the admin UI and the metadata comes from
the upload form + the governance-editing endpoints, not a code entry here.
This module only matters for the OLDER, engineer-triggered path (bulk-
loading a known dataset from a shell/CLI without going through the upload
UI) -- which a brand-new deployment may not need to use at all if it's
just going to receive its data through self-service uploads from the start.

For a new deployment: delete every entry below (leave the empty dicts) and
skip straight to creating your first admin (`app/create_admin.py`) and
uploading your own data through the admin UI. Only add entries back here
if you specifically need to bulk-load data via `dispatch_cli.py` instead.
See docs/reuse.md for the full new-deployment checklist.
"""

# Keyed by dataset slug. See worker/tasks.py's ingest_task/curate_task/
# load_postgis_task for exactly which fields each step reads.
#
# `sensitivity: "public"` for the real LandMark datasets below is a
# deliberate choice, not a default: LandMark's own site already publishes
# this exact data under CC BY-SA 4.0, and replicating their public map is
# this deployment's explicit goal -- whatever precision/withholding
# decision LandMark made is already baked into what they released.
# `serve_mode` records which tile path each dataset uses once published
# (brief §3 traffic split) -- both still load into PostGIS regardless,
# since FastAPI's feature-detail endpoint always queries Postgres directly.
DATASET_META = {
    "kenya-admin1-provinces": {
        "name": "Kenya Admin-1 Provinces (stand-in fixture)",
        "description": (
            "Disposable Phase-0 fixture used to prove the ingest -> curate -> "
            "publish -> tile pipeline end-to-end. Not LandMark data."
        ),
        "source": "Natural Earth 1:10m Admin-1 States/Provinces (ne_10m_admin_1_states_provinces)",
        "license": "Public domain -- no attribution required (naturalearthdata.com/about/terms-of-use)",
        "attribution": "Natural Earth",
        "sensitivity": "public",
        "serve_mode": "martin",
        "dedup_key": "name",
    },
    "landmark-indicative-areas": {
        "name": "Indicative Areas of Indigenous and Community Land Rights",
        "description": (
            "Areas indicatively held or used by Indigenous Peoples and local "
            "communities, but not yet formally documented/acknowledged -- one "
            "of LandMark's six core datasets (brief §15)."
        ),
        "source": "LandMark: The Global Platform of Indigenous and Community Lands (landmarkmap.org)",
        "license": "CC BY-SA 4.0, subject to LandMark's Terms of Service",
        "attribution": "LandMark: The Global Platform of Indigenous and Community Lands",
        "sensitivity": "public",
        "serve_mode": "pmtiles",
        "dedup_key": None,  # OGC_FID is already a unique per-row source id
    },
    "landmark-indigenous-community-lands": {
        "name": "Indigenous Peoples' and Local Community Lands and Territories",
        "description": (
            "Community-level lands and territories acknowledged by governments "
            "(and some not formally acknowledged) -- LandMark's flagship dataset "
            "(brief §15), global coverage."
        ),
        "source": "LandMark: The Global Platform of Indigenous and Community Lands (landmarkmap.org)",
        "license": "CC BY-SA 4.0, subject to LandMark's Terms of Service",
        "attribution": "LandMark: The Global Platform of Indigenous and Community Lands",
        "sensitivity": "public",
        "serve_mode": "pmtiles",
        "dedup_key": None,
    },
}

# Same shape, for worker/tabular_tasks.py's spreadsheet-ingest path (brief
# §1.4) -- entirely separate from DATASET_META above because tabular
# datasets skip the geometry medallion tiers altogether (see that module's
# docstring). `file_path` is a path inside the `worker` container's
# read-only `./data:/data:ro` mount (docker-compose.yml) -- a new
# deployment supplying its own spreadsheets needs its own files under
# `data/` and its own entries here; there is no upload-UI equivalent for
# this path (Phase 4's self-service flow is geometry-only, brief §16).
TABULAR_DATASET_META = {
    "cbd-headline-indicator-22-1": {
        "name": "CBD Headline Indicator 22.1",
        "description": (
            "Convention on Biological Diversity Kunming-Montreal target "
            "tracker data for headline indicator 22.1 (recognition of "
            "Indigenous/community lands), by country and year."
        ),
        "file_path": "/data/landmark/tabular/CBD_Headline_Indicator_22_1_June2026.xlsx",
        "sheet": "Target Tracker data",
        "iso_col": "iso3cd",
    },
    "indigenous-population-per-country": {
        "name": "Indigenous Population per Country",
        "description": "Estimated Indigenous population and share of national population, by country.",
        "file_path": "/data/landmark/tabular/Indigenous_population_Aug2024.xlsx",
        "sheet": "Indigenous_population_Aug2024",
        "iso_col": "iso_code",
    },
    "pct-ip-comm-lands": {
        "name": "Percent of Country Held by Indigenous Peoples & Local Communities",
        "description": "Share of national land area formally/indicatively held by Indigenous Peoples and local communities, by country.",
        "file_path": "/data/landmark/tabular/PCT_IPCommLands_Aug2024v2.xlsx",
        "sheet": "PCT_IPCommLands_Aug2024v2",
        "iso_col": "iso_code",
    },
    "tenure-security-community": {
        "name": "Indicators of Tenure Security in National Law (Community)",
        "description": "Scored indicators evaluating national legal tenure security for community-held lands, by country.",
        "file_path": "/data/landmark/tabular/TenureSecurityIndicators_202509.xls",
        "sheet": "Community",
        "iso_col": "iso_code",
    },
    "tenure-security-ip": {
        "name": "Indicators of Tenure Security in National Law (Indigenous Peoples)",
        "description": "Scored indicators evaluating national legal tenure security for Indigenous Peoples' lands, by country.",
        "file_path": "/data/landmark/tabular/TenureSecurityIndicators_202509.xls",
        "sheet": "IP",
        "iso_col": "iso_code",
    },
}

# Same for all five tabular datasets -- all sourced from the same LandMark
# data-access grant (brief §1.1) under the same terms. Delete alongside
# TABULAR_DATASET_META above; nothing else references these two names.
TABULAR_SOURCE = "LandMark: The Global Platform of Indigenous and Community Lands (landmarkmap.org)"
TABULAR_LICENSE = "CC BY-SA 4.0, subject to LandMark's Terms of Service"
TABULAR_ATTRIBUTION = "LandMark: The Global Platform of Indigenous and Community Lands"
