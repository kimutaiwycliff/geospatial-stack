# API image, reused as-is by the `worker` and `flower` compose services
# (they override CMD) -- one image, one dependency set, for everything that
# runs Python app code in this stack (brief §9/§17, §1.2).
#
# Multi-stage: tippecanoe is compiled from source (same rationale as
# tiles/build/Dockerfile -- no trustworthy prebuilt image, and Debian/Ubuntu
# don't package it) in a throwaway builder stage, so the final image doesn't
# carry build-essential/git or the tippecanoe source tree. The worker needs
# tippecanoe on PATH to run the tile-build Celery task (brief §5 step 5);
# `api` and `flower` never invoke it, but sharing one image beats a second
# Dockerfile to keep in sync for that one binary.
FROM python:3.12-slim AS tippecanoe-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libsqlite3-dev zlib1g-dev git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
    && make -C /tmp/tippecanoe -j"$(nproc)" \
    && make -C /tmp/tippecanoe install \
    && rm -rf /tmp/tippecanoe

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=tippecanoe-builder /usr/local/bin/tippecanoe* /usr/local/bin/
COPY --from=tippecanoe-builder /usr/local/bin/tile-join /usr/local/bin/

WORKDIR /app

# requirements.txt copied (and installed) before the rest of app/ so that
# editing application code doesn't invalidate Docker's pip-install layer --
# only a requirements.txt change should trigger a re-install.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY worker/ ./worker/

# Security audit finding: this image (shared by api/worker/flower/
# celery-exporter) ran as root with no USER directive at all -- the worker
# specifically runs DuckDB/GDAL/tippecanoe against arbitrary curator-
# uploaded data, so a future parsing bug there getting root inside the
# container is a materially worse outcome than getting a restricted user.
#
# --create-home (NOT --no-create-home, which this originally used): DuckDB
# needs a real, writable home directory of its own (it resolves one to
# `~/.duckdb` for extension installation/config state regardless of
# whether the worker's own code ever touches it) and errors outright --
# "Can't find the home directory at '/home/appuser'" -- if `/etc/passwd`
# points at a home dir that was never actually created on disk, which is
# exactly what `--no-create-home` did. A real production upload hit this:
# every DuckDB-backed ingest (worker/tasks.py's `_run_ingest`) failed
# after this image's non-root switch, until caught and fixed here.
RUN useradd --system --create-home --uid 10001 appuser
USER appuser

# docker-compose.yml's healthcheck curls http://localhost:8000/healthz from
# *inside* this container, so uvicorn must bind 0.0.0.0 (not 127.0.0.1) and
# the port here must match the healthcheck's port exactly. `worker`/`flower`
# override this CMD entirely (see docker-compose.yml).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
