"""Minimal Celery queue-depth exporter (brief §12: "job queue depth").

Judgment call: Celery has no native Prometheus endpoint. The obvious
off-the-shelf answer, `celery-prometheus-exporter`, hasn't been released
since the Celery 4 era and doesn't install cleanly against the Celery
version pinned in requirements.txt -- adopting an unmaintained package for
one number is worse than not having the number. Flower (already in this
stack) shows queue length in its own UI, but doesn't expose it as a
Prometheus metric Grafana can graph/alert on.

So: the broker IS Redis (REDIS_URL, same as worker/celery_app.py), and
Celery's redis transport stores each queue's pending tasks as a plain Redis
LIST keyed by the queue name -- LLEN on that key *is* the queue depth, no
Celery-internal API needed. This script polls LLEN on a small interval and
republishes it as a Gauge. It's a few lines instead of a dependency, and it
can't drift from what Celery actually does since it reads the same broker.

Only the default "celery" queue exists today -- worker/celery_app.py never
calls `task_routes`, so every task lands on Celery's implicit default queue.
CELERY_QUEUE_NAMES exists as an escape hatch for whenever that changes.
"""
import os
import time

import redis
from prometheus_client import Gauge, start_http_server

QUEUE_NAMES = [q.strip() for q in os.environ.get("CELERY_QUEUE_NAMES", "celery").split(",") if q.strip()]
POLL_INTERVAL_SECONDS = 5
EXPORTER_PORT = 9808

queue_depth = Gauge(
    "celery_queue_depth",
    "Pending tasks in a Celery queue (Redis LLEN on the queue's list key).",
    ["queue"],
)


def main():
    r = redis.Redis.from_url(os.environ["REDIS_URL"])
    start_http_server(EXPORTER_PORT)
    while True:
        for queue in QUEUE_NAMES:
            queue_depth.labels(queue=queue).set(r.llen(queue))
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
