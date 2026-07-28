"""Unit tests for app/auth/security.py -- deliberately DB-free (same
constraint as test_healthz.py: this file runs in CI's test-api job, which
has no Postgres service). JWT_SECRET is set here rather than relying on
.env, matching how DATABASE_URL is left unset for test_healthz -- these
tests should pass with zero environment setup.
"""
import os
import time

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-prod")

import jwt
import pytest
from app.auth.security import create_access_token, decode_access_token, hash_password, verify_password


def test_hash_password_round_trips():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert not verify_password("wrong password", hashed)


def test_access_token_round_trips_claims():
    token = create_access_token("user-123", "admin@example.org", "admin")
    payload = decode_access_token(token)
    assert payload["sub"] == "user-123"
    assert payload["email"] == "admin@example.org"
    assert payload["role"] == "admin"


def test_decode_rejects_expired_token(monkeypatch):
    monkeypatch.setenv("JWT_ACCESS_TOKEN_TTL_MINUTES", "0")
    token = create_access_token("user-123", "admin@example.org", "admin")
    time.sleep(1)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token)


def test_decode_rejects_bad_signature():
    token = create_access_token("user-123", "admin@example.org", "admin")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(tampered)
