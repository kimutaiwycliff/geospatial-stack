# Run from repo root as `make -C tiles/build build-pmtiles`.
SLUG := kenya-admin1-provinces
NETWORK := geospatial_stack_default
IMAGE := geoplatform-tiles-build

.PHONY: build build-pmtiles

build:
	docker build -t $(IMAGE) -f Dockerfile .

build-pmtiles: build
	docker run --rm --network $(NETWORK) --env-file ../../.env $(IMAGE) python build_pmtiles.py $(SLUG)
