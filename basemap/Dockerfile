# One-off basemap build tool -- unlike api/worker (a long-running service),
# this image exists to run build_basemap.sh once and exit. It's kept
# separate from the api/worker image because it needs the go-pmtiles CLI
# (the Go binary, distinct from the `pmtiles` npm/pip JS/Python libraries
# used elsewhere in this repo) and nothing else it does is needed at
# request-serving time.
FROM python:3.12-slim

# TARGETARCH is set automatically by Docker buildx -- go-pmtiles ships
# separate arm64/amd64 binaries, so hardcoding one would break on whichever
# platform didn't build this image (this repo has been built on both Apple
# Silicon dev machines and will run on x86_64 VPS hosts later).
ARG TARGETARCH
ARG GO_PMTILES_VERSION=1.31.2

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sL "https://github.com/protomaps/go-pmtiles/releases/download/v${GO_PMTILES_VERSION}/go-pmtiles_${GO_PMTILES_VERSION}_Linux_${TARGETARCH}.tar.gz" \
       -o /tmp/go-pmtiles.tar.gz \
    && tar -xzf /tmp/go-pmtiles.tar.gz -C /usr/local/bin pmtiles \
    && rm /tmp/go-pmtiles.tar.gz

RUN pip install --no-cache-dir boto3==1.35.36

WORKDIR /work
COPY build_basemap.py .
COPY common.py .

# Security audit finding: every container in this stack ran as root by
# default (no Dockerfile anywhere had a USER directive). This one only
# reads a public tile source and writes to S3/MinIO over the network --
# no reason for it to hold root inside its own container while doing so.
RUN useradd --system --no-create-home --uid 10001 appuser
USER appuser

CMD ["python3", "build_basemap.py"]
