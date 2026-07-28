"""Connection-per-request Postgres helper.

Phase 0 traffic is a single-endpoint demo, so a pooled connection (psycopg2's
pool, or an async driver like asyncpg) would be premature machinery -- opening
a fresh connection per request is simplest to reason about and fast enough at
this scale. Tradeoff noted for later: revisit with a pool if this becomes a
bottleneck (Phase 1+ traffic).
"""
import os

import psycopg2
from psycopg2.extras import RealDictCursor


def get_connection():
    """Open one psycopg2 connection; caller owns closing it.

    DATABASE_URL is read here (call time), not at module import time, so
    importing this module -- e.g. transitively via `from app.main import app`
    in tests -- never blows up just because the env var isn't set yet (the
    /healthz endpoint in particular must be testable with zero DB config).

    Same DSN scheme dbmate and the ETL scripts use (see .env.example:
    postgres://user:pass@db:5432/dbname?sslmode=disable) -- one connection
    string format across every process that talks to this Postgres, so
    there's no per-service "translate the URL" step anywhere in the stack.

    RealDictCursor returns rows as {column: value} dicts instead of plain
    tuples, so main.py can build the JSON response without hand-mapping
    tuple positions to column names.
    """
    database_url = os.environ["DATABASE_URL"]
    return psycopg2.connect(database_url, cursor_factory=RealDictCursor)
