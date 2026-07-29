"""Celery application instance (brief §1.2, §2 "Celery keeps the worker in
the same runtime and language as FastAPI and the ETL code").

Redis is both broker and result backend -- one dependency already present
in the stack (brief §2), no separate result store to run/monitor.

`-A worker.celery_app worker` / `-A worker.celery_app flower` in
docker-compose.yml both point here; this module's only job is to construct
the app and make sure `worker.tasks` is imported so its @celery_app.task
functions register.
"""
import os

import sentry_sdk
from app.logging_config import JsonFormatter
from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger
from sentry_sdk.integrations.celery import CeleryIntegration


# Structured logging (brief follow-up: "collects logs well") -- Celery
# installs its own formatter on its loggers during startup regardless of
# anything the API side does (app/logging_config.py's configure_logging()
# only ever runs in the api/uvicorn process, a separate container). These
# two signals are Celery's own documented hook for swapping the formatter
# on an already-configured logger/task-logger, without disabling Celery's
# entire logging setup the way overriding the `setup_logging` signal would
# (which would also mean losing Celery's own log-level/redirect-stdout
# handling). Reuses the identical JsonFormatter the API uses -- one
# implementation, not two.
@after_setup_logger.connect
@after_setup_task_logger.connect
def _use_json_formatter(logger=None, **_kwargs):
    for handler in logger.handlers:
        handler.setFormatter(JsonFormatter())

# Sentry (brief §12), worker side. FastAPI has its own sentry_sdk.init() in
# app/main.py -- API and worker are separate processes (separate
# containers), so each needs its own init() call even though they share one
# Docker image. Same no-DSN-means-no-op contract as the API: this must not
# error or send anything until a real SENTRY_DSN is set. CeleryIntegration
# is what turns an uncaught exception inside a @celery_app.task (tiling,
# ingest, curate -- worker/tasks.py) into a Sentry event instead of just a
# Celery FAILURE state that only Flower sees.
sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN", ""),
    integrations=[CeleryIntegration()],
    traces_sample_rate=0,
)

celery_app = Celery(
    "geoplatform",
    broker=os.environ["REDIS_URL"],
    backend=os.environ["REDIS_URL"],
    include=["worker.tasks", "worker.tabular_tasks"],
)

# Late/soft time limits: a stuck tippecanoe or DuckDB S3 call should fail
# loudly (and let Celery retry/report it) rather than hang a worker slot
# forever. Generous because tiling a real (non-fixture) dataset can
# legitimately take minutes.
celery_app.conf.update(
    task_soft_time_limit=600,
    task_time_limit=900,
    # Track when a task starts, not just when it finishes -- Flower/the
    # admin UI's progress display (Phase 4) needs STARTED, not just
    # PENDING -> SUCCESS/FAILURE, to show "in progress" at all.
    task_track_started=True,
)
