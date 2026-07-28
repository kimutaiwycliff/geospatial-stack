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

from celery import Celery

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
