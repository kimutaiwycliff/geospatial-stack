"""One-off CLI for creating the first (and any subsequent) admin account --
brief §10's locked auth path says "no public signup route exists anywhere",
so this is the only way an `auth.users` row with role='admin' ever gets
created. Run from inside the `api` container (shares its image/venv with
`worker`, same reasoning as worker/dispatch_cli.py):

    docker compose exec api python -m app.create_admin <email> <password>

Deliberately a plain script, not a Celery task or FastAPI route -- creating
an admin is an operator action taken once per person, not something that
needs a job queue or an HTTP surface (which would just re-open the "how is
THIS endpoint authenticated" question for the very endpoint that bootstraps
auth).
"""
import sys

from app.auth.security import hash_password
from app.db import get_connection


def create_admin(email: str, password: str) -> None:
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth.users (email, password_hash, role)
                VALUES (%s, %s, 'admin')
                ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'
                RETURNING id
                """,
                (email, hash_password(password)),
            )
            user_id = cur.fetchone()["id"]
    finally:
        conn.close()
    print(f"admin user ready: {email} ({user_id})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python -m app.create_admin <email> <password>", file=sys.stderr)
        sys.exit(1)
    create_admin(sys.argv[1], sys.argv[2])
