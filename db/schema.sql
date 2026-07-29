\restrict dbmate

-- Dumped from database version 17.5 (Debian 17.5-1.pgdg110+1)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: curated; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA curated;


--
-- Name: published; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA published;


--
-- Name: raw; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA raw;


--
-- Name: registry; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA registry;


--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger_data;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: role; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.role AS ENUM (
    'viewer',
    'admin'
);


--
-- Name: map_status; Type: TYPE; Schema: registry; Owner: -
--

CREATE TYPE registry.map_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: sensitivity; Type: TYPE; Schema: registry; Owner: -
--

CREATE TYPE registry.sensitivity AS ENUM (
    'public',
    'restricted',
    'withheld'
);


--
-- Name: serve_mode; Type: TYPE; Schema: registry; Owner: -
--

CREATE TYPE registry.serve_mode AS ENUM (
    'pmtiles',
    'martin'
);


--
-- Name: style_status; Type: TYPE; Schema: registry; Owner: -
--

CREATE TYPE registry.style_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: tier_status; Type: TYPE; Schema: registry; Owner: -
--

CREATE TYPE registry.tier_status AS ENUM (
    'raw',
    'curated',
    'published'
);


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: registry; Owner: -
--

CREATE FUNCTION registry.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role auth.role DEFAULT 'viewer'::auth.role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: registry; Owner: -
--

CREATE TABLE registry.audit_log (
    id bigint NOT NULL,
    actor_id uuid,
    actor_email text NOT NULL,
    action text NOT NULL,
    dataset_slug text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: registry; Owner: -
--

CREATE SEQUENCE registry.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: registry; Owner: -
--

ALTER SEQUENCE registry.audit_log_id_seq OWNED BY registry.audit_log.id;


--
-- Name: datasets; Type: TABLE; Schema: registry; Owner: -
--

CREATE TABLE registry.datasets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    source text,
    license text,
    attribution text,
    sensitivity registry.sensitivity DEFAULT 'withheld'::registry.sensitivity NOT NULL,
    crs text DEFAULT 'EPSG:4326'::text NOT NULL,
    geometry_type text,
    extent public.geometry(Polygon,4326),
    tier_status registry.tier_status DEFAULT 'raw'::registry.tier_status NOT NULL,
    serve_mode registry.serve_mode,
    schema_json jsonb,
    created_by text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    validation_report jsonb
);


--
-- Name: layer_styles; Type: TABLE; Schema: registry; Owner: -
--

CREATE TABLE registry.layer_styles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dataset_id uuid NOT NULL,
    status registry.style_status DEFAULT 'draft'::registry.style_status NOT NULL,
    style_json jsonb NOT NULL,
    updated_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: maps; Type: TABLE; Schema: registry; Owner: -
--

CREATE TABLE registry.maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    layers_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    basemap text DEFAULT 'light'::text NOT NULL,
    default_extent jsonb,
    filters_json jsonb,
    legend_json jsonb,
    status registry.map_status DEFAULT 'draft'::registry.map_status NOT NULL,
    created_by text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    controls_json jsonb DEFAULT '{"logo": {"enabled": false, "position": "bottom-left"}, "globe": {"enabled": false, "position": "top-right"}, "scale": {"enabled": false, "position": "bottom-left"}, "legend": {"enabled": false, "position": "bottom-left"}, "search": {"enabled": false, "position": "top-left"}, "compass": {"enabled": false, "position": "top-right"}, "measure": {"enabled": false, "position": "top-left"}, "minimap": {"enabled": false, "position": "bottom-right"}, "bookmark": {"enabled": false, "position": "top-left"}, "geolocate": {"enabled": false, "position": "top-right"}, "gridlines": {"enabled": false, "position": "top-right"}, "atmosphere": {"enabled": false, "position": "top-right"}, "fullscreen": {"enabled": true, "position": "top-right"}, "navigation": {"enabled": true, "position": "top-right"}, "attribution": {"enabled": true, "position": "bottom-right"}, "spinning-globe": {"enabled": false, "position": "top-right"}}'::jsonb NOT NULL
);


--
-- Name: audit_log id; Type: DEFAULT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.audit_log ALTER COLUMN id SET DEFAULT nextval('registry.audit_log_id_seq'::regclass);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: datasets datasets_pkey; Type: CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);


--
-- Name: datasets datasets_slug_key; Type: CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.datasets
    ADD CONSTRAINT datasets_slug_key UNIQUE (slug);


--
-- Name: layer_styles layer_styles_pkey; Type: CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.layer_styles
    ADD CONSTRAINT layer_styles_pkey PRIMARY KEY (id);


--
-- Name: maps maps_pkey; Type: CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.maps
    ADD CONSTRAINT maps_pkey PRIMARY KEY (id);


--
-- Name: maps maps_slug_key; Type: CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.maps
    ADD CONSTRAINT maps_slug_key UNIQUE (slug);


--
-- Name: audit_log_created_at_idx; Type: INDEX; Schema: registry; Owner: -
--

CREATE INDEX audit_log_created_at_idx ON registry.audit_log USING btree (created_at DESC);


--
-- Name: audit_log_dataset_slug_idx; Type: INDEX; Schema: registry; Owner: -
--

CREATE INDEX audit_log_dataset_slug_idx ON registry.audit_log USING btree (dataset_slug);


--
-- Name: datasets_extent_gix; Type: INDEX; Schema: registry; Owner: -
--

CREATE INDEX datasets_extent_gix ON registry.datasets USING gist (extent);


--
-- Name: datasets_tier_status_idx; Type: INDEX; Schema: registry; Owner: -
--

CREATE INDEX datasets_tier_status_idx ON registry.datasets USING btree (tier_status);


--
-- Name: layer_styles_dataset_status_uidx; Type: INDEX; Schema: registry; Owner: -
--

CREATE UNIQUE INDEX layer_styles_dataset_status_uidx ON registry.layer_styles USING btree (dataset_id, status);


--
-- Name: maps_status_idx; Type: INDEX; Schema: registry; Owner: -
--

CREATE INDEX maps_status_idx ON registry.maps USING btree (status);


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION registry.set_updated_at();


--
-- Name: datasets datasets_set_updated_at; Type: TRIGGER; Schema: registry; Owner: -
--

CREATE TRIGGER datasets_set_updated_at BEFORE UPDATE ON registry.datasets FOR EACH ROW EXECUTE FUNCTION registry.set_updated_at();


--
-- Name: layer_styles layer_styles_set_updated_at; Type: TRIGGER; Schema: registry; Owner: -
--

CREATE TRIGGER layer_styles_set_updated_at BEFORE UPDATE ON registry.layer_styles FOR EACH ROW EXECUTE FUNCTION registry.set_updated_at();


--
-- Name: maps maps_set_updated_at; Type: TRIGGER; Schema: registry; Owner: -
--

CREATE TRIGGER maps_set_updated_at BEFORE UPDATE ON registry.maps FOR EACH ROW EXECUTE FUNCTION registry.set_updated_at();


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: layer_styles layer_styles_dataset_id_fkey; Type: FK CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.layer_styles
    ADD CONSTRAINT layer_styles_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES registry.datasets(id) ON DELETE CASCADE;


--
-- Name: layer_styles layer_styles_updated_by_fkey; Type: FK CONSTRAINT; Schema: registry; Owner: -
--

ALTER TABLE ONLY registry.layer_styles
    ADD CONSTRAINT layer_styles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260728000001'),
    ('20260728000002'),
    ('20260728000003'),
    ('20260729000001'),
    ('20260729000002'),
    ('20260729000003');
