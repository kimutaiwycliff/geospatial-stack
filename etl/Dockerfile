# One image reused for every pipeline step (ingest/curate/contract-test/load).
# Phase 1 (brief §1.2) moves this same code into Celery tasks sharing the api
# image; kept as its own lightweight image for now so the vertical slice
# doesn't need FastAPI/uvicorn just to run a DuckDB script.
FROM python:3.12-slim

# libpq for psycopg2 at runtime (psycopg2-binary vendors most of it, but the
# slim base still needs the shared client lib present).
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
