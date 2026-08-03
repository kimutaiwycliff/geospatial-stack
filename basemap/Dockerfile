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

# go-pmtiles' release assets name the Linux x86_64 build "x86_64", not
# "amd64" -- Docker buildx's TARGETARCH says "amd64" on that platform, so it
# has to be remapped here or the download 404s (arm64 happens to match both
# naming schemes, which is why this only broke on amd64 hosts).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && GO_PMTILES_ARCH=$( [ "$TARGETARCH" = "amd64" ] && echo x86_64 || echo "$TARGETARCH" ) \
    && curl -sfL "https://github.com/protomaps/go-pmtiles/releases/download/v${GO_PMTILES_VERSION}/go-pmtiles_${GO_PMTILES_VERSION}_Linux_${GO_PMTILES_ARCH}.tar.gz" \
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
#
# --create-home (not --no-create-home): the sibling api/Dockerfile's
# identical --no-create-home broke DuckDB in production (no real, writable
# home directory for it to resolve `~/.duckdb` against -- see that file's
# comment) -- the go-pmtiles CLI/boto3 here haven't shown the same failure,
# but there's no upside to leaving this container without a real home
# directory either, and it's one line to avoid the same class of bug
# resurfacing here later.
RUN useradd --system --create-home --uid 10001 appuser
USER appuser

CMD ["python3", "build_basemap.py"]
