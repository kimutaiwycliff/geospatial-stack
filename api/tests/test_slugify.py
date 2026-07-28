"""Unit tests for app/registry/slugs.py -- pure function, no DB needed."""
import pytest
from app.registry.slugs import slugify


def test_slugify_lowercases_and_hyphenates():
    assert slugify("Kenya Admin-1 Provinces") == "kenya-admin-1-provinces"


def test_slugify_collapses_repeated_separators():
    assert slugify("  Multiple   Spaces!! ") == "multiple-spaces"


def test_slugify_strips_leading_trailing_hyphens():
    assert slugify("-already-hyphenated-") == "already-hyphenated"


def test_slugify_rejects_empty_result():
    with pytest.raises(ValueError):
        slugify("!!!")
