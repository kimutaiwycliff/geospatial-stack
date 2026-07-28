"""Password hashing + JWT issuing/verification (brief §10: "FastAPI-native
now -- pyjwt + passlib, roles viewer/admin").

No user model class here on purpose -- every call site already has a
`RealDictCursor` row (a plain dict with `id`/`email`/`role` keys) from
app/db.py, so this module works with that dict shape directly rather than
introducing a second representation of the same row.
"""
import os
import time
from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

# bcrypt is the one scheme configured -- this app never needs to read a
# legacy hash format, so there's no "list of schemes to support" to build.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return _pwd_context.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return _pwd_context.verify(plain_password, password_hash)


def _jwt_secret() -> str:
    # Read at call time, not import time -- same reasoning as app/db.py's
    # get_connection: importing this module (e.g. transitively through
    # app.main in tests) must never blow up just because JWT_SECRET isn't
    # set in that process's env yet.
    return os.environ["JWT_SECRET"]


def _jwt_algorithm() -> str:
    return os.environ.get("JWT_ALGORITHM", "HS256")


def create_access_token(user_id: str, email: str, role: str) -> str:
    """Issues a signed JWT carrying the three claims every admin-gated route
    needs (`sub`, `email`, `role`) plus standard `iat`/`exp`. TTL comes from
    JWT_ACCESS_TOKEN_TTL_MINUTES (.env.example) -- no refresh-token flow yet
    (brief §10 lists "secure session/refresh" but Phase 3 is a single admin
    role signing in from one browser tab; re-login on expiry is enough for
    now, refresh tokens are a Horizon-2-scale concern).
    """
    ttl_minutes = int(os.environ.get("JWT_ACCESS_TOKEN_TTL_MINUTES", "60"))
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(time.mktime(now.timetuple())),
        "exp": now + timedelta(minutes=ttl_minutes),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_jwt_algorithm())


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError (expired/invalid signature/malformed) -- callers
    (app/auth/dependencies.py) turn that into a 401, this module stays
    HTTP-agnostic."""
    return jwt.decode(token, _jwt_secret(), algorithms=[_jwt_algorithm()])
