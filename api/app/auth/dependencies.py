"""FastAPI dependencies gating the admin routes (styles, governance).

`OAuth2PasswordBearer` over a bare `Header(...)` param purely for the
Swagger UI "Authorize" button it wires up for free at /docs -- the SPA
itself just sends a plain `Authorization: Bearer <token>` header either way.
"""
import jwt
from app.auth.security import decode_access_token
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

# tokenUrl points at the login route below (app/routers/auth.py) -- only
# used by the Swagger UI to know where to POST credentials from, FastAPI
# itself never calls it.
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def get_current_user(token: str = Depends(_oauth2_scheme)) -> dict:
    """Decodes the bearer token into `{id, email, role}`. A 401 here (bad
    signature, expired, malformed) is indistinguishable to the caller from
    "never logged in" -- both just mean "send valid credentials again",
    so there's no separate error code for each failure mode."""
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    return {"id": payload["sub"], "email": payload["email"], "role": payload["role"]}


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """brief §10: "Authorization is always enforced server-side in FastAPI;
    the SPA only holds the token -- it never decides who can publish or
    upload." `viewer` is a valid, successfully-authenticated role -- this
    is the one place that role actually gets turned away from something."""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
