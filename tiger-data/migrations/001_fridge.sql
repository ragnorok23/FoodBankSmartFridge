BEGIN;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE SCHEMA IF NOT EXISTS fridge;
CREATE TABLE IF NOT EXISTS fridge.schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fridge.fridges (
  id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fridge.fridges(id,name) VALUES ('orion-fridge-01','CodeRED Community Fridge') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS fridge.sensor_readings (
  captured_at timestamptz NOT NULL,
  event_id uuid NOT NULL,
  fridge_id text NOT NULL REFERENCES fridge.fridges(id),
  device_id text NOT NULL,
  temperature_c double precision CHECK(temperature_c BETWEEN -40 AND 85),
  moisture_raw integer CHECK(moisture_raw BETWEEN 0 AND 1023),
  air_quality_raw integer CHECK(air_quality_raw BETWEEN 0 AND 1023),
  metadata jsonb NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(captured_at,event_id)
);
SELECT create_hypertable('fridge.sensor_readings','captured_at',if_not_exists=>true);
CREATE INDEX IF NOT EXISTS sensor_fridge_time ON fridge.sensor_readings(fridge_id,captured_at DESC);
CREATE TABLE IF NOT EXISTS fridge.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  barcode text UNIQUE CHECK(barcode IS NULL OR barcode ~ '^[0-9]{8,14}$'),
  brand text, variant text, package_size text,
  display_image_url text, image_source_url text,
  match_method text NOT NULL CHECK(match_method IN ('barcode','visual','manual','generic')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fridge.donation_proposals (
  id uuid PRIMARY KEY,
  fridge_id text NOT NULL REFERENCES fridge.fridges(id),
  product_id uuid NOT NULL REFERENCES fridge.products(id),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  identification_method text NOT NULL CHECK(identification_method IN ('gemini','barcode','manual')),
  certainty text NOT NULL CHECK(certainty IN ('high','medium','low','unknown')),
  status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','donor_confirmed','cancelled')),
  observation_image_url text, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS fridge.inventory_events (
  id uuid PRIMARY KEY,
  fridge_id text NOT NULL REFERENCES fridge.fridges(id),
  product_id uuid NOT NULL REFERENCES fridge.products(id),
  proposal_id uuid UNIQUE REFERENCES fridge.donation_proposals(id),
  kind text NOT NULL CHECK(kind IN ('donation','pickup','adjustment')),
  quantity_delta integer NOT NULL CHECK(quantity_delta <> 0),
  verification text NOT NULL CHECK(verification IN ('donor_confirmed','operator_confirmed')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS inventory_fridge_time ON fridge.inventory_events(fridge_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS fridge.camera_audits (
  id uuid PRIMARY KEY,
  fridge_id text NOT NULL REFERENCES fridge.fridges(id),
  captured_at timestamptz NOT NULL,
  image_quality text NOT NULL CHECK(image_quality IN ('usable','limited','unusable')),
  model text NOT NULL, result jsonb NOT NULL,
  comparison jsonb NOT NULL DEFAULT '{}',
  observation_image_url text,
  requires_review boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audits_fridge_time ON fridge.camera_audits(fridge_id,captured_at DESC);
CREATE OR REPLACE VIEW fridge.inventory_balances AS
SELECT e.fridge_id,p.id AS product_id,p.canonical_name,p.barcode,p.display_image_url,
  sum(e.quantity_delta)::integer AS recorded_quantity,max(e.occurred_at) AS last_event_at
FROM fridge.inventory_events e JOIN fridge.products p ON p.id=e.product_id
GROUP BY e.fridge_id,p.id;
CREATE OR REPLACE VIEW fridge.sensor_five_minute AS
SELECT fridge_id,time_bucket('5 minutes',captured_at) AS bucket,
  avg(temperature_c) AS average_temperature_c,min(temperature_c) AS min_temperature_c,
  max(temperature_c) AS max_temperature_c,avg(moisture_raw) AS average_moisture_raw,
  avg(air_quality_raw) AS average_air_quality_raw,count(*) AS sample_count
FROM fridge.sensor_readings GROUP BY fridge_id,bucket;
INSERT INTO fridge.schema_migrations(version) VALUES('001_fridge') ON CONFLICT DO NOTHING;
COMMIT;
