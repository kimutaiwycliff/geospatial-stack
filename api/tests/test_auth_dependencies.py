"""Unit tests for app/auth/dependencies.py -- exercised as plain functions
(FastAPI resolves `Depends(...)` for us in real requests, but these two
dependencies take a decoded token / a dict, so they're just as testable
called directly, no TestClient or DB needed).
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-prod")

import pytest
from app.auth.dependencies import get_current_user, require_admin
from app.auth.security import create_access_token
from fastapi import HTTPException


def test_get_current_user_decodes_valid_token():
    token = create_access_token("user-1", "viewer@example.org", "viewer")
    user = get_current_user(token)
    assert user == {"id": "user-1", "email": "viewer@example.org", "role": "viewer"}


def test_get_current_user_rejects_garbage_token():
    with pytest.raises(HTTPException) as exc_info:
        get_current_user("not-a-real-token")
    assert exc_info.value.status_code == 401


def test_require_admin_allows_admin_role():
    admin = {"id": "user-1", "email": "admin@example.org", "role": "admin"}
    assert require_admin(admin) == admin


def test_require_admin_rejects_viewer_role():
    viewer = {"id": "user-1", "email": "viewer@example.org", "role": "viewer"}
    with pytest.raises(HTTPException) as exc_info:
        require_admin(viewer)
    assert exc_info.value.status_code == 403
