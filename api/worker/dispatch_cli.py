"""Dev convenience: `python -m worker.dispatch_cli <source_path> <slug>
[--static]`, run from inside the worker container -- dispatches the same
chain a real ingestion trigger would and blocks until it finishes, for a
quick local check without needing to watch Flower separately.

Deliberately its OWN module, not a `__main__` block inside tasks.py: running
`python -m worker.tasks` would import worker.tasks as `__main__`, and Celery
falls back to naming tasks defined in `__main__` after the app (e.g.
"geoplatform.ingest_task") instead of their real module path
("worker.tasks.ingest_task") -- so a chain dispatched from that process
addresses tasks under a name the actual worker process (which imports
worker.tasks as a normal module) never registered, and every task comes
back `NotRegistered`. Importing `run_pipeline` from a separate module sidesteps
this entirely: worker.tasks is never anyone's `__main__`.
"""
import sys

from worker.tasks import run_pipeline

if __name__ == "__main__":
    result = run_pipeline(sys.argv[1], sys.argv[2], build_static="--static" in sys.argv)
    print(result.get(timeout=300))
