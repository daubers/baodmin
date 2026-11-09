-- Sample database for the docker-compose demo (runs once, on first start). Throwaway: all names and
-- passwords here are fake. OpenBao's database engine connects as "openbao" and creates, rotates and
-- drops logins for the dynamic and static roles that docker/seed.sh configures.

-- The account OpenBao itself uses. CREATEROLE lets it make and drop the short-lived logins.
CREATE ROLE openbao WITH LOGIN PASSWORD 'openbao-sample' CREATEROLE;

-- A fixed login for the static role: OpenBao rotates its password on a schedule instead of creating it.
CREATE ROLE app_static WITH LOGIN PASSWORD 'initial-not-a-real-password';
GRANT app_static TO openbao WITH ADMIN OPTION;

CREATE TABLE customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  total_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'new',
  placed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO customers (name, email) VALUES
  ('Ada Example', 'ada@example.test'),
  ('Grace Sample', 'grace@example.test'),
  ('Linus Placeholder', 'linus@example.test');

INSERT INTO orders (customer_id, total_cents, status) VALUES
  (1, 4200, 'shipped'),
  (1, 1999, 'new'),
  (2, 12500, 'shipped'),
  (3, 800, 'cancelled');

-- OpenBao hands these out to the logins it creates, so it must hold them WITH GRANT OPTION.
GRANT CONNECT ON DATABASE app TO openbao;
GRANT USAGE ON SCHEMA public TO openbao WITH GRANT OPTION;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openbao WITH GRANT OPTION;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO openbao WITH GRANT OPTION;

-- What the static login may do.
GRANT CONNECT ON DATABASE app TO app_static;
GRANT USAGE ON SCHEMA public TO app_static;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_static;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_static;
