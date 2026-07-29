"""Shared slowapi Limiter instance (security audit finding: `/auth/login`
had zero throttling -- the only credentialed entry point into the whole
admin/upload/publish surface was open to unlimited-attempt brute force /
credential stuffing, and the docker-compose.yml `proxy` comment claiming
Caddy does "rate limit" was aspirational, not actually configured anywhere).

A separate module (not defined inline in main.py or auth.py) so both can
import the same Limiter instance without a main<->auth circular import.

Redis-backed (REDIS_URL, already a hard dependency everywhere else in this
stack) rather than slowapi's in-memory default -- a restart-safe limit that
survives an `api` container recycling, instead of one that silently resets
to zero attempts-so-far on every deploy/crash.

Falls back to slowapi's own in-memory store when REDIS_URL isn't set
(`os.environ.get`, not `os.environ[...]`) -- app/main.py imports this
module at the top level, and test_healthz.py's whole point is that
`/healthz` -- and therefore importing app.main -- works with ZERO env
config (see that test's own docstring; a past bug here was module-level
code eagerly requiring REDIS_URL, breaking exactly this invariant). Every
real deployment sets REDIS_URL via .env regardless, so this fallback only
ever matters for that zero-config import case.
"""
import os

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri=os.environ.get("REDIS_URL", "memory://"))
