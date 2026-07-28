-- migrate:up

-- FastAPI-native auth (brief §10): roles `viewer` (public/implicit, no row
-- needed) and `admin` (needs a real account). No public signup route exists
-- anywhere in this schema or the API on purpose -- admin accounts are
-- created out-of-band (a seed script/CLI), matching brief §10's "the SPA
-- never decides who can publish": if there's no signup endpoint, there's
-- nothing for the SPA to even attempt.
CREATE SCHEMA auth;

CREATE TYPE auth.role AS ENUM ('viewer', 'admin');

CREATE TABLE auth.users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          auth.role NOT NULL DEFAULT 'viewer',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reuses registry.set_updated_at() from migration 1 -- one "touch
-- updated_at" trigger function shared across every table that needs it,
-- rather than a copy per schema.
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION registry.set_updated_at();

-- Live styling, draft -> publish (brief §6.3). One dataset can have at most
-- one draft row and at most one published row at a time (the unique index
-- below) -- "publish" copies the draft's style_json into the published
-- row rather than promoting/deleting rows, so the curator's draft keeps
-- existing (and keeps being editable) right after publishing, instead of
-- needing a fresh draft created from scratch every time.
CREATE TYPE registry.style_status AS ENUM ('draft', 'published');

CREATE TABLE registry.layer_styles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id  UUID NOT NULL REFERENCES registry.datasets(id) ON DELETE CASCADE,
    status      registry.style_status NOT NULL DEFAULT 'draft',
    -- MapLibre paint/layout property object, e.g. {"fill-color": "#2563eb",
    -- "fill-opacity": 0.35} -- applied client-side via setPaintProperty, so
    -- publishing a style change never requires re-tiling (brief §6.3).
    style_json  JSONB NOT NULL,
    updated_by  UUID REFERENCES auth.users(id),
    version     INT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX layer_styles_dataset_status_uidx ON registry.layer_styles (dataset_id, status);

CREATE TRIGGER layer_styles_set_updated_at
    BEFORE UPDATE ON registry.layer_styles
    FOR EACH ROW
    EXECUTE FUNCTION registry.set_updated_at();

-- Audit trail (brief §13: "critical once Horizon 2 opens uploads to more
-- users"; brief §3.3). actor_email is denormalized (kept even if the
-- actor_id's user is later deleted) -- an audit log that goes blank for a
-- departed admin's past actions defeats its own purpose.
CREATE TABLE registry.audit_log (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email  TEXT NOT NULL,
    action       TEXT NOT NULL,
    dataset_slug TEXT,
    details      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_dataset_slug_idx ON registry.audit_log (dataset_slug);
CREATE INDEX audit_log_created_at_idx ON registry.audit_log (created_at DESC);

-- migrate:down

DROP TABLE IF EXISTS registry.audit_log;
DROP TRIGGER IF EXISTS layer_styles_set_updated_at ON registry.layer_styles;
DROP TABLE IF EXISTS registry.layer_styles;
DROP TYPE IF EXISTS registry.style_status;
DROP TRIGGER IF EXISTS users_set_updated_at ON auth.users;
DROP TABLE IF EXISTS auth.users;
DROP TYPE IF EXISTS auth.role;
DROP SCHEMA IF EXISTS auth;
