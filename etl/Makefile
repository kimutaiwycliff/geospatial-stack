# Phase-0 pipeline runner. Each target runs the etl image as a one-off
# container on the compose network so it can reach `db`/`storage` by service
# name exactly like the future Celery worker will (brief §1.2 moves this
# same code into api/worker/tasks.py once Phase 1 starts).
SLUG := kenya-admin1-provinces
SOURCE := data/stand_in/kenya_admin1_provinces.geojson
NETWORK := geospatial_stack_default
IMAGE := geoplatform-etl

.PHONY: build ingest curate test publish pipeline

build:
	docker build -t $(IMAGE) -f Dockerfile .

# --env-file/-v paths are relative to the repo root, not etl/, since that's
# where `make` is invoked from for these targets (see root-level convenience,
# if added) -- run `make -C etl <target>` from the repo root.
run = docker run --rm --network $(NETWORK) --env-file ../.env -v $(CURDIR)/..:/repo -w /repo/etl $(IMAGE)

ingest: build
	$(run) python pipelines/ingest.py /repo/$(SOURCE) $(SLUG)

curate: build
	$(run) python pipelines/curate.py $(SLUG)

test: build
	$(run) env DATASET_SLUG=$(SLUG) pytest contracts/ -v

publish: test
	$(run) python pipelines/load_postgis.py $(SLUG)

pipeline: ingest curate test publish
