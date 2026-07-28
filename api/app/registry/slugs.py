"""Shared slug derivation -- both the upload flow (app/routers/uploads.py)
and Map authoring (app/routers/maps.py) turn a curator-typed name into a
URL-safe registry identifier the same way, so this lives once rather than
being reimplemented per router.
"""
import re


def slugify(text: str) -> str:
    """Lowercase, non-alnum runs collapsed to a single hyphen, no leading/
    trailing hyphen. Deliberately simple (no transliteration of non-ASCII)
    -- every slug this codebase has ever used (DATASET_META's keys, brief
    §15's dataset list) is plain ASCII, and this only needs to match that."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        raise ValueError("name produces an empty slug")
    return slug
