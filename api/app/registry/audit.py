"""Writes to `registry.audit_log` (brief §13: "audit trail for who
published/changed what"). One function, called from every admin mutation
(style save/publish, governance edit) right before that mutation's own
transaction commits, so an audit row and the change it describes always
land together or not at all.
"""
import json


def write_audit_log(cur, actor: dict, action: str, dataset_slug: str | None, details: dict | None) -> None:
    """`cur` is a cursor on the SAME connection/transaction as the caller's
    own write -- this does not open its own connection or commit, so the
    caller's `with conn, conn.cursor()` block covers both statements
    atomically. `actor_email` is passed through even though `actor_id` is
    also stored, because audit_log.actor_email is intentionally denormalized
    (see the migration's comment) to survive the actor's row being deleted."""
    cur.execute(
        """
        INSERT INTO registry.audit_log (actor_id, actor_email, action, dataset_slug, details)
        VALUES (%(actor_id)s, %(actor_email)s, %(action)s, %(dataset_slug)s, %(details)s)
        """,
        {
            "actor_id": actor["id"],
            "actor_email": actor["email"],
            "action": action,
            "dataset_slug": dataset_slug,
            "details": _to_jsonb(details),
        },
    )


def _to_jsonb(details: dict | None):
    return json.dumps(details) if details is not None else None
