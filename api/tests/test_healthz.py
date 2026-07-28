"""Smoke test for the container healthcheck target (docker-compose.yml `api`
service healthcheck curls this exact path). Deliberately never touches
Postgres -- /healthz has no DB dependency by design (see app/main.py's
comment on why), so this test must never need a live database to pass.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz_returns_ok():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
