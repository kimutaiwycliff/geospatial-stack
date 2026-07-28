# Builds tippecanoe from source -- there's no official prebuilt image pin
# stable enough to trust for a client hand-off, and Debian/Ubuntu don't
# package it, so compiling it here is the reproducible option (also means
# this Dockerfile IS the documentation of which tippecanoe commit produced
# a given tileset).
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libsqlite3-dev zlib1g-dev git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
    && make -C /tmp/tippecanoe -j"$(nproc)" \
    && make -C /tmp/tippecanoe install \
    && rm -rf /tmp/tippecanoe

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-0 libpq5 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/bin/tippecanoe* /usr/local/bin/
COPY --from=builder /usr/local/bin/tile-join /usr/local/bin/

WORKDIR /work
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
