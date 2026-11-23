CREATE SCHEMA IF NOT EXISTS hunter;
CREATE TABLE IF NOT EXISTS hunter.candidate (
  key text PRIMARY KEY,
  source text NOT NULL,
  source_url text NOT NULL,
  payload jsonb NOT NULL,
  confidence int NOT NULL,
  decision text NOT NULL CHECK (decision IN ('PUBLISH','REVIEW','NO_VENUE','REJECTED','PUBLISHED')),
  reasons text[] NOT NULL DEFAULT '{}',
  askout_ref text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_decision_idx ON hunter.candidate (decision);
CREATE TABLE IF NOT EXISTS hunter.run (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  connector text NOT NULL,
  found int NOT NULL DEFAULT 0,
  error text
);
CREATE TABLE IF NOT EXISTS hunter.cost (
  day date NOT NULL,
  provider text NOT NULL,
  calls int NOT NULL DEFAULT 0,
  tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);
