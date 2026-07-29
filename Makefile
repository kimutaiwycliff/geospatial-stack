# Operator shortcuts over `docker compose`/`dbmate`/the admin-creation CLI.
# Nothing here does anything docker-compose.yml/scripts/bootstrap-new-
# deployment.sh couldn't already do by hand -- this just wraps the
# multi-step or easy-to-typo sequences (wiping volumes, creating the first
# admin) into single commands. Run `make help` for the list.
.PHONY: help up down restart build logs ps migrate create-admin wipe fresh-start

help:
	@echo "make up            -- start the stack (builds images if needed)"
	@echo "make down          -- stop the stack, KEEP data (db/object storage volumes survive)"
	@echo "make restart       -- down + up"
	@echo "make build         -- rebuild images (run after pulling code changes)"
	@echo "make logs          -- follow logs for all services (Ctrl-C to stop watching)"
	@echo "make ps            -- show service status"
	@echo "make migrate       -- apply any pending db migrations"
	@echo "make create-admin EMAIL=you@example.org PASSWORD=... -- create/reset an admin account"
	@echo "make wipe          -- DESTROYS all data (db + uploads + tiles) and stops the stack. Asks to confirm."
	@echo "make fresh-start   -- wipe, then rebuild and bring the stack back up from empty. Asks to confirm."

up:
	docker compose up -d

down:
	docker compose down

restart: down up

build:
	docker compose build

logs:
	docker compose logs -f

ps:
	docker compose ps

# dbmate applies whatever's new under db/migrations/ and exits -- this is
# also what `docker compose up` runs automatically via the `migrate`
# service's `depends_on`, exposed here for when you've added a migration
# to an ALREADY-running stack and don't want to restart everything else.
migrate:
	docker compose run --rm migrate

# EMAIL/PASSWORD are make variables, not shell env vars -- pass them the
# same way: `make create-admin EMAIL=foo@bar.org PASSWORD=hunter2`.
# `python -m app.create_admin` itself is an upsert (ON CONFLICT DO UPDATE,
# see api/app/create_admin.py) -- running this again for an email that
# already exists resets that account's password rather than failing, which
# is also how you'd change a forgotten admin password later.
create-admin:
	@if [ -z "$(EMAIL)" ] || [ -z "$(PASSWORD)" ]; then \
		echo "usage: make create-admin EMAIL=you@example.org PASSWORD=your-password"; \
		exit 1; \
	fi
	docker compose exec api python -m app.create_admin "$(EMAIL)" "$(PASSWORD)"

# `down -v` removes the named volumes docker-compose.yml declares for
# Postgres/MinIO/Redis/Grafana/Prometheus -- every uploaded dataset, every
# Map, every admin account, every audit log entry, gone. There is no undo
# short of a backup restore (see docs/backups.md) -- the confirmation
# prompt is deliberate, not decoration.
wipe:
	@echo "This deletes ALL data: every dataset, map, admin account, and audit log entry. There is no undo."
	@read -p "Type 'wipe' to confirm: " confirm; \
	if [ "$$confirm" != "wipe" ]; then \
		echo "Aborted -- nothing was touched."; \
		exit 1; \
	fi
	docker compose down -v

# The full "start over from nothing" loop: wipe (with its own confirmation),
# rebuild in case code changed since the images were last built, bring the
# stack up, and wait for migrate to apply the schema fresh. After this,
# the only thing left to do is `make create-admin` (see docs/reuse.md for
# why there's no signup UI -- that's a deliberate security decision, not a
# missing feature).
fresh-start: wipe build up
	@echo
	@echo "Stack is up on a fresh database. Next: make create-admin EMAIL=... PASSWORD=..."
