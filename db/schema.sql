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
-- Name: cbd_headline_indicator_22_1; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.cbd_headline_indicator_22_1 (
    id bigint NOT NULL,
    name text,
    iso_code text,
    scale text,
    year double precision,
    "group" text,
    value text,
    units text,
    footnote text
);


--
-- Name: cbd_headline_indicator_22_1_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.cbd_headline_indicator_22_1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cbd_headline_indicator_22_1_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.cbd_headline_indicator_22_1_id_seq OWNED BY published.cbd_headline_indicator_22_1.id;


--
-- Name: indigenous_population_per_country; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.indigenous_population_per_country (
    id bigint NOT NULL,
    iso_code text,
    un_reg text,
    un_subreg text,
    country text,
    pop text,
    pct text,
    pctcat text,
    popcat text,
    peoples text,
    sources text,
    note text,
    datacontri text
);


--
-- Name: pct_ip_comm_lands; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.pct_ip_comm_lands (
    id bigint NOT NULL,
    oid double precision,
    iso_code text,
    un_reg text,
    un_subreg text,
    country text,
    ctry_land double precision,
    ic_t text,
    ic_t_ha text,
    ic_t_src text,
    ic_t_cat text,
    ic_f text,
    ic_f_ha text,
    ic_f_src text,
    ic_f_cat text,
    ic_nf text,
    ic_nf_ha text,
    ic_nf_src text,
    ic_nf_cat text,
    ic_notes text,
    more_info text,
    shape_leng double precision,
    shape_area double precision
);


--
-- Name: tenure_security_community; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.tenure_security_community (
    id bigint NOT NULL,
    oid double precision,
    country text,
    iso_code text,
    framework text,
    language text,
    i1_scr double precision,
    i1_com text,
    i1_lap text,
    i1_addinfo text,
    i2_scr double precision,
    i2_com text,
    i2_lap text,
    i2_addinfo text,
    i3_scr double precision,
    i3_com text,
    i3_lap text,
    i3_addinfo text,
    i4_scr double precision,
    i4_com text,
    i4_lap text,
    i4_addinfo text,
    i5_scr double precision,
    i5_com text,
    i5_lap text,
    i5_addinfo text,
    i6_scr double precision,
    i6_com text,
    i6_lap text,
    i6_addinfo text,
    i7_scr double precision,
    i7_com text,
    i7_lap text,
    i7_addinfo text,
    i8_scr double precision,
    i8_com text,
    i8_lap text,
    i8_addinfo text,
    i9_scr double precision,
    i9_com text,
    i9_lap text,
    i9_addinfo text,
    i10_scr double precision,
    i10_com text,
    i10_lap text,
    i10_addinfo text,
    source text,
    current_avg_scr double precision,
    current_avg_scr_cat text,
    current_scr_date double precision
);


--
-- Name: tenure_security_ip; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.tenure_security_ip (
    id bigint NOT NULL,
    oid double precision,
    country text,
    iso_code text,
    objectid double precision,
    oid1 double precision,
    country_1 text,
    iso_code_1 text,
    framework text,
    language text,
    i1_scr double precision,
    i1_com text,
    i1_lap text,
    i1_addinfo text,
    i2_scr double precision,
    i2_com text,
    i2_lap text,
    i2_addinfo text,
    i3_scr double precision,
    i3_com text,
    i3_lap text,
    i3_addinfo text,
    i4_scr double precision,
    i4_com text,
    i4_lap text,
    i4_addinfo2 text,
    i5_scr double precision,
    i5_com text,
    i5_lap text,
    i5_addinfo text,
    i6_scr double precision,
    i6_com text,
    i6_lap text,
    i6_addinfo text,
    i7_scr double precision,
    i7_com text,
    i7_lap text,
    i7_addinfo text,
    i8_scr double precision,
    i8_com text,
    i8_lap text,
    i8_addinfo text,
    i9_scr double precision,
    i9_com text,
    i9_lap text,
    i9_addinfo text,
    i10_scr double precision,
    i10_com text,
    i10_lap text,
    i10_addinfo text,
    source text,
    current_avg_scr double precision,
    current_avg_scr_cat text,
    current_scr_date double precision
);


--
-- Name: country_summary; Type: VIEW; Schema: published; Owner: -
--

CREATE VIEW published.country_summary AS
 SELECT pop.iso_code,
    pop.un_reg AS pop_un_reg,
    pop.un_subreg AS pop_un_subreg,
    pop.country AS pop_country,
    pop.pop AS pop_pop,
    pop.pct AS pop_pct,
    pop.pctcat AS pop_pctcat,
    pop.popcat AS pop_popcat,
    pop.peoples AS pop_peoples,
    pop.sources AS pop_sources,
    pop.note AS pop_note,
    pop.datacontri AS pop_datacontri,
    pct.oid AS pct_oid,
    pct.un_reg AS pct_un_reg,
    pct.un_subreg AS pct_un_subreg,
    pct.country AS pct_country,
    pct.ctry_land AS pct_ctry_land,
    pct.ic_t AS pct_ic_t,
    pct.ic_t_ha AS pct_ic_t_ha,
    pct.ic_t_src AS pct_ic_t_src,
    pct.ic_t_cat AS pct_ic_t_cat,
    pct.ic_f AS pct_ic_f,
    pct.ic_f_ha AS pct_ic_f_ha,
    pct.ic_f_src AS pct_ic_f_src,
    pct.ic_f_cat AS pct_ic_f_cat,
    pct.ic_nf AS pct_ic_nf,
    pct.ic_nf_ha AS pct_ic_nf_ha,
    pct.ic_nf_src AS pct_ic_nf_src,
    pct.ic_nf_cat AS pct_ic_nf_cat,
    pct.ic_notes AS pct_ic_notes,
    pct.more_info AS pct_more_info,
    pct.shape_leng AS pct_shape_leng,
    pct.shape_area AS pct_shape_area,
    tsic.oid AS tsic_oid,
    tsic.country AS tsic_country,
    tsic.framework AS tsic_framework,
    tsic.language AS tsic_language,
    tsic.i1_scr AS tsic_i1_scr,
    tsic.i1_com AS tsic_i1_com,
    tsic.i1_lap AS tsic_i1_lap,
    tsic.i1_addinfo AS tsic_i1_addinfo,
    tsic.i2_scr AS tsic_i2_scr,
    tsic.i2_com AS tsic_i2_com,
    tsic.i2_lap AS tsic_i2_lap,
    tsic.i2_addinfo AS tsic_i2_addinfo,
    tsic.i3_scr AS tsic_i3_scr,
    tsic.i3_com AS tsic_i3_com,
    tsic.i3_lap AS tsic_i3_lap,
    tsic.i3_addinfo AS tsic_i3_addinfo,
    tsic.i4_scr AS tsic_i4_scr,
    tsic.i4_com AS tsic_i4_com,
    tsic.i4_lap AS tsic_i4_lap,
    tsic.i4_addinfo AS tsic_i4_addinfo,
    tsic.i5_scr AS tsic_i5_scr,
    tsic.i5_com AS tsic_i5_com,
    tsic.i5_lap AS tsic_i5_lap,
    tsic.i5_addinfo AS tsic_i5_addinfo,
    tsic.i6_scr AS tsic_i6_scr,
    tsic.i6_com AS tsic_i6_com,
    tsic.i6_lap AS tsic_i6_lap,
    tsic.i6_addinfo AS tsic_i6_addinfo,
    tsic.i7_scr AS tsic_i7_scr,
    tsic.i7_com AS tsic_i7_com,
    tsic.i7_lap AS tsic_i7_lap,
    tsic.i7_addinfo AS tsic_i7_addinfo,
    tsic.i8_scr AS tsic_i8_scr,
    tsic.i8_com AS tsic_i8_com,
    tsic.i8_lap AS tsic_i8_lap,
    tsic.i8_addinfo AS tsic_i8_addinfo,
    tsic.i9_scr AS tsic_i9_scr,
    tsic.i9_com AS tsic_i9_com,
    tsic.i9_lap AS tsic_i9_lap,
    tsic.i9_addinfo AS tsic_i9_addinfo,
    tsic.i10_scr AS tsic_i10_scr,
    tsic.i10_com AS tsic_i10_com,
    tsic.i10_lap AS tsic_i10_lap,
    tsic.i10_addinfo AS tsic_i10_addinfo,
    tsic.source AS tsic_source,
    tsic.current_avg_scr AS tsic_current_avg_scr,
    tsic.current_avg_scr_cat AS tsic_current_avg_scr_cat,
    tsic.current_scr_date AS tsic_current_scr_date,
    tsii.oid AS tsii_oid,
    tsii.country AS tsii_country,
    tsii.objectid AS tsii_objectid,
    tsii.oid1 AS tsii_oid1,
    tsii.country_1 AS tsii_country_1,
    tsii.iso_code_1 AS tsii_iso_code_1,
    tsii.framework AS tsii_framework,
    tsii.language AS tsii_language,
    tsii.i1_scr AS tsii_i1_scr,
    tsii.i1_com AS tsii_i1_com,
    tsii.i1_lap AS tsii_i1_lap,
    tsii.i1_addinfo AS tsii_i1_addinfo,
    tsii.i2_scr AS tsii_i2_scr,
    tsii.i2_com AS tsii_i2_com,
    tsii.i2_lap AS tsii_i2_lap,
    tsii.i2_addinfo AS tsii_i2_addinfo,
    tsii.i3_scr AS tsii_i3_scr,
    tsii.i3_com AS tsii_i3_com,
    tsii.i3_lap AS tsii_i3_lap,
    tsii.i3_addinfo AS tsii_i3_addinfo,
    tsii.i4_scr AS tsii_i4_scr,
    tsii.i4_com AS tsii_i4_com,
    tsii.i4_lap AS tsii_i4_lap,
    tsii.i4_addinfo2 AS tsii_i4_addinfo2,
    tsii.i5_scr AS tsii_i5_scr,
    tsii.i5_com AS tsii_i5_com,
    tsii.i5_lap AS tsii_i5_lap,
    tsii.i5_addinfo AS tsii_i5_addinfo,
    tsii.i6_scr AS tsii_i6_scr,
    tsii.i6_com AS tsii_i6_com,
    tsii.i6_lap AS tsii_i6_lap,
    tsii.i6_addinfo AS tsii_i6_addinfo,
    tsii.i7_scr AS tsii_i7_scr,
    tsii.i7_com AS tsii_i7_com,
    tsii.i7_lap AS tsii_i7_lap,
    tsii.i7_addinfo AS tsii_i7_addinfo,
    tsii.i8_scr AS tsii_i8_scr,
    tsii.i8_com AS tsii_i8_com,
    tsii.i8_lap AS tsii_i8_lap,
    tsii.i8_addinfo AS tsii_i8_addinfo,
    tsii.i9_scr AS tsii_i9_scr,
    tsii.i9_com AS tsii_i9_com,
    tsii.i9_lap AS tsii_i9_lap,
    tsii.i9_addinfo AS tsii_i9_addinfo,
    tsii.i10_scr AS tsii_i10_scr,
    tsii.i10_com AS tsii_i10_com,
    tsii.i10_lap AS tsii_i10_lap,
    tsii.i10_addinfo AS tsii_i10_addinfo,
    tsii.source AS tsii_source,
    tsii.current_avg_scr AS tsii_current_avg_scr,
    tsii.current_avg_scr_cat AS tsii_current_avg_scr_cat,
    tsii.current_scr_date AS tsii_current_scr_date
   FROM (((published.indigenous_population_per_country pop
     LEFT JOIN published.pct_ip_comm_lands pct ON ((pct.iso_code = pop.iso_code)))
     LEFT JOIN published.tenure_security_community tsic ON ((tsic.iso_code = pop.iso_code)))
     LEFT JOIN published.tenure_security_ip tsii ON ((tsii.iso_code = pop.iso_code)));


--
-- Name: indigenous_population_per_country_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.indigenous_population_per_country_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: indigenous_population_per_country_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.indigenous_population_per_country_id_seq OWNED BY published.indigenous_population_per_country.id;


--
-- Name: kenya_admin1_provinces; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.kenya_admin1_provinces (
    id bigint NOT NULL,
    "OGC_FID" text,
    name text,
    type text,
    iso_3166_2 text,
    admin text,
    latitude double precision,
    longitude double precision,
    geom public.geometry(Geometry,4326) NOT NULL
);


--
-- Name: kenya_admin1_provinces_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.kenya_admin1_provinces_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kenya_admin1_provinces_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.kenya_admin1_provinces_id_seq OWNED BY published.kenya_admin1_provinces.id;


--
-- Name: landmark_indicative_areas; Type: TABLE; Schema: published; Owner: -
--

CREATE TABLE published.landmark_indicative_areas (
    id bigint NOT NULL,
    "OGC_FID" text,
    identity text,
    name text,
    form_rec text,
    doc_status text,
    stat_date text,
    stat_note text,
    country text,
    category text,
    ethncty_1 text,
    populatn text,
    pop_source text,
    pop_year text,
    area_ofcl text,
    area_gis text,
    scale text,
    method text,
    data_ctrb text,
    data_src text,
    data_src_s text,
    data_src_l text,
    data_date text,
    add_note text,
    more_info text,
    layer text,
    download text,
    iso_code text,
    landmark_i text,
    "Shape_Leng" text,
    "Shape_Area" text,
    geom public.geometry(Geometry,4326) NOT NULL
);


--
-- Name: landmark_indicative_areas_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.landmark_indicative_areas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: landmark_indicative_areas_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.landmark_indicative_areas_id_seq OWNED BY published.landmark_indicative_areas.id;


--
-- Name: pct_ip_comm_lands_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.pct_ip_comm_lands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pct_ip_comm_lands_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.pct_ip_comm_lands_id_seq OWNED BY published.pct_ip_comm_lands.id;


--
-- Name: tenure_security_community_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.tenure_security_community_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenure_security_community_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.tenure_security_community_id_seq OWNED BY published.tenure_security_community.id;


--
-- Name: tenure_security_ip_id_seq; Type: SEQUENCE; Schema: published; Owner: -
--

CREATE SEQUENCE published.tenure_security_ip_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenure_security_ip_id_seq; Type: SEQUENCE OWNED BY; Schema: published; Owner: -
--

ALTER SEQUENCE published.tenure_security_ip_id_seq OWNED BY published.tenure_security_ip.id;


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
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cbd_headline_indicator_22_1 id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.cbd_headline_indicator_22_1 ALTER COLUMN id SET DEFAULT nextval('published.cbd_headline_indicator_22_1_id_seq'::regclass);


--
-- Name: indigenous_population_per_country id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.indigenous_population_per_country ALTER COLUMN id SET DEFAULT nextval('published.indigenous_population_per_country_id_seq'::regclass);


--
-- Name: kenya_admin1_provinces id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.kenya_admin1_provinces ALTER COLUMN id SET DEFAULT nextval('published.kenya_admin1_provinces_id_seq'::regclass);


--
-- Name: landmark_indicative_areas id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.landmark_indicative_areas ALTER COLUMN id SET DEFAULT nextval('published.landmark_indicative_areas_id_seq'::regclass);


--
-- Name: pct_ip_comm_lands id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.pct_ip_comm_lands ALTER COLUMN id SET DEFAULT nextval('published.pct_ip_comm_lands_id_seq'::regclass);


--
-- Name: tenure_security_community id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.tenure_security_community ALTER COLUMN id SET DEFAULT nextval('published.tenure_security_community_id_seq'::regclass);


--
-- Name: tenure_security_ip id; Type: DEFAULT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.tenure_security_ip ALTER COLUMN id SET DEFAULT nextval('published.tenure_security_ip_id_seq'::regclass);


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
-- Name: cbd_headline_indicator_22_1 cbd_headline_indicator_22_1_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.cbd_headline_indicator_22_1
    ADD CONSTRAINT cbd_headline_indicator_22_1_pkey PRIMARY KEY (id);


--
-- Name: indigenous_population_per_country indigenous_population_per_country_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.indigenous_population_per_country
    ADD CONSTRAINT indigenous_population_per_country_pkey PRIMARY KEY (id);


--
-- Name: kenya_admin1_provinces kenya_admin1_provinces_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.kenya_admin1_provinces
    ADD CONSTRAINT kenya_admin1_provinces_pkey PRIMARY KEY (id);


--
-- Name: landmark_indicative_areas landmark_indicative_areas_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.landmark_indicative_areas
    ADD CONSTRAINT landmark_indicative_areas_pkey PRIMARY KEY (id);


--
-- Name: pct_ip_comm_lands pct_ip_comm_lands_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.pct_ip_comm_lands
    ADD CONSTRAINT pct_ip_comm_lands_pkey PRIMARY KEY (id);


--
-- Name: tenure_security_community tenure_security_community_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.tenure_security_community
    ADD CONSTRAINT tenure_security_community_pkey PRIMARY KEY (id);


--
-- Name: tenure_security_ip tenure_security_ip_pkey; Type: CONSTRAINT; Schema: published; Owner: -
--

ALTER TABLE ONLY published.tenure_security_ip
    ADD CONSTRAINT tenure_security_ip_pkey PRIMARY KEY (id);


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
-- Name: cbd_headline_indicator_22_1_iso_idx; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX cbd_headline_indicator_22_1_iso_idx ON published.cbd_headline_indicator_22_1 USING btree (iso_code);


--
-- Name: indigenous_population_per_country_iso_idx; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX indigenous_population_per_country_iso_idx ON published.indigenous_population_per_country USING btree (iso_code);


--
-- Name: kenya_admin1_provinces_geom_gix; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX kenya_admin1_provinces_geom_gix ON published.kenya_admin1_provinces USING gist (geom);


--
-- Name: landmark_indicative_areas_geom_gix; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX landmark_indicative_areas_geom_gix ON published.landmark_indicative_areas USING gist (geom);


--
-- Name: pct_ip_comm_lands_iso_idx; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX pct_ip_comm_lands_iso_idx ON published.pct_ip_comm_lands USING btree (iso_code);


--
-- Name: tenure_security_community_iso_idx; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX tenure_security_community_iso_idx ON published.tenure_security_community USING btree (iso_code);


--
-- Name: tenure_security_ip_iso_idx; Type: INDEX; Schema: published; Owner: -
--

CREATE INDEX tenure_security_ip_iso_idx ON published.tenure_security_ip USING btree (iso_code);


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
    ('20260728000003');
