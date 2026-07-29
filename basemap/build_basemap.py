"""Self-hosted OSM basemap (brief §1.5): extracts a world, low/mid-zoom
subset from Protomaps' publicly-hosted daily planet build via HTTP range
requests (`pmtiles extract`) -- NOT a full 137GB planet download, and NOT
running Planetiler ourselves (that needs a Java/Maven toolchain + hours of
OSM PBF processing for planet scale). Range-request extraction only pulls
the bytes this bbox+zoom actually needs.

World scope, not a single country: LandMark's datasets are global (the
Indicative Areas layer alone spans dozens of countries), so a country-only
basemap would leave every other country's data with no base map underneath
it. maxzoom=8 keeps this genuinely small -- Protomaps' own docs note each
zoom level roughly doubles output size, and z8 is enough for country/
region-level browsing (the level most users interact with a world map at);
deeper per-region zoom can be extracted later if a specific area needs it.

Result uploaded to object storage under `basemap/`, publicly readable --
the whole point of self-hosting is that MapLibre/pmtiles-js fetches it
directly, no API key, no external runtime dependency. The MapLibre style
itself is generated client-side by the frontend (web/) using the
`@protomaps/basemaps` npm package's `layers()`/`namedFlavor()` -- this
script only produces the tile *data*.
"""
import json
import os
import subprocess
import tempfile
import urllib.request

from botocore.exceptions import ClientError

from common import get_s3_client, s3_config, upload_file

BUILDS_MANIFEST_URL = "https://build-metadata.protomaps.dev/builds.json"
# +/-85, not +/-90: Web Mercator (what these tiles are projected in) is
# undefined at the poles: 85.0511 is the standard "full world" bound.
WORLD_BBOX = "-180,-85,180,85"
MAXZOOM = "8"
DEST_KEY = "basemap/basemap.pmtiles"


def _already_built() -> bool:
    """This image runs as a normal one-shot compose service (like `migrate`),
    which means `docker compose up` re-creates and re-runs it on every single
    invocation, not just the very first `fresh-start` -- dbmate gets that for
    free because applying an already-applied migration is a no-op, but a
    fresh `pmtiles extract` against Protomaps' CDN has no such built-in
    idempotency. Without this check, every `make up`/`make restart` would
    silently redo a multi-hundred-MB range-request extraction that already
    succeeded, which is slow and (for anyone metered on egress) not free.
    `BASEMAP_FORCE_REBUILD=true` escapes this when a genuine refresh is
    wanted (e.g. picking up a newer daily Protomaps build)."""
    if os.environ.get("BASEMAP_FORCE_REBUILD", "").lower() == "true":
        return False
    client = get_s3_client()
    try:
        client.head_object(Bucket=s3_config()["bucket"], Key=DEST_KEY)
        return True
    except ClientError as exc:
        # A bucket that doesn't exist yet (first-ever boot, before
        # `ensure_bucket`-equivalent logic below runs) 404s the same as a
        # missing key -- both mean "not built yet", not an error.
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NoSuchBucket"):
            return False
        raise


def latest_build_url() -> str:
    # Queries the manifest the Protomaps app itself uses (see
    # app/src/Builds.tsx) rather than hardcoding today's date -- builds are
    # daily, so a fixed filename here would silently go stale.
    # A User-Agent header is required -- their CDN 403s urllib's default
    # ("Python-urllib/3.x"), presumably basic bot filtering.
    req = urllib.request.Request(BUILDS_MANIFEST_URL, headers={"User-Agent": "geoplatform-basemap-build/1.0"})
    with urllib.request.urlopen(req) as resp:
        builds = json.load(resp)
    latest_key = builds[-1]["key"]
    return f"https://build.protomaps.com/{latest_key}"


def main():
    if _already_built():
        print(f"build_basemap: s3://.../{DEST_KEY} already exists -- skipping "
              f"(set BASEMAP_FORCE_REBUILD=true to force a re-extract)")
        return

    source_url = latest_build_url()
    print(f"build_basemap: extracting bbox={WORLD_BBOX} maxzoom={MAXZOOM} from {source_url}")

    with tempfile.TemporaryDirectory() as tmp:
        output_path = f"{tmp}/basemap.pmtiles"
        subprocess.run(
            [
                "pmtiles", "extract", source_url, output_path,
                f"--bbox={WORLD_BBOX}", f"--maxzoom={MAXZOOM}",
            ],
            check=True,
        )
        upload_file(output_path, DEST_KEY, public_prefix="basemap/")
        print(f"build_basemap: uploaded to s3://.../{DEST_KEY}")


if __name__ == "__main__":
    main()
