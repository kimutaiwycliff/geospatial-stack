"""Structured (JSON) logging setup (brief follow-up: "connect the
observability tools ... collects logs well"). Plain-text log lines from
uvicorn/Celery's default `--loglevel=INFO` formatting end up as unstructured
text once shipped through Promtail into Loki (see ops/promtail/) --
greppable, but not filterable/aggregatable by field the way a JSON line is
(status code, duration, request id, dataset slug, ...). This swaps every
handler's formatter for one that emits a single JSON object per line;
stdout/stderr itself is unchanged -- Docker's `json-file` log driver (what
Promtail actually tails) captures whatever a container prints, structured or
not.

Shared between the API (app/main.py) and the worker (worker/celery_app.py,
via Celery's after_setup_logger signal) -- one formatter, not two
reimplementations, since both run in the same image/process model.
"""
import json
import logging
import sys

_BASE_RECORD_ATTRS = frozenset(vars(logging.LogRecord("", 0, "", 0, "", None, None)).keys())


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Anything passed via `logger.info(..., extra={...})` (e.g. this
        # app's own request_id/method/path/status_code/duration_ms fields,
        # see main.py's log_requests middleware) rides along as extra
        # LogRecord attributes -- only surface ones that aren't one of
        # logging's own built-in attributes, so this doesn't leak record
        # internals (pathname, process, thread, ...) into every line.
        for key, value in vars(record).items():
            if key not in _BASE_RECORD_ATTRS and key not in payload:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Call once, at process startup, before any other logging happens."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn installs its own handlers on these three loggers by default --
    # replace them too, or access/error logs stay plain text while
    # everything else goes JSON. `propagate = False` stops a duplicate
    # second copy of each line from also flowing up through root's handler.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = [handler]
        uv_logger.propagate = False
