-- Agency procurement schema (major version 2, see app.schema_version()).
-- Security model: the application runs every request as the non-superuser
-- role procurement_user inside a transaction with app.user_id / app.org_id
-- set. Row-level security separates organizations, A社's branches and the two
-- companies. Triggers enforce the workflow, compute every amount, number
-- requests and purchase orders, and write the audit log and the notification
-- outbox, so no application code path can skip them.
--
-- Two prices: what a maker charges B社 (cost) and what B社 charges A社
-- (selling price). Every cost, markup and profit figure lives in tables A社
-- staff cannot read at all (makers, maker_quotes, quote_costs); app.quotes,
-- which A社 reads, holds selling prices only. Quotes to A社 are created only
-- by app.issue_quote(), a SECURITY DEFINER function that checks the caller
-- itself; procurement_user has no INSERT on quotes or quote_costs.
--
-- Workflow: an A社 branch (client) sends a request through B社's intake form
-- -> B社 (agent) may ask questions (hearing) and A社 answers -> B社 fixes the
-- product outline -> asks one or more makers for quotes and records their
-- replies -> issues a quote to A社 from one maker quote with a markup or set
-- prices, plus shipping and expenses -> A社 agrees (or asks for a revision)
-- -> B社 orders from that maker (purchase order to the maker) -> B社 fixes the
-- delivery date, which sends A社 the delivery notice.

CREATE SCHEMA IF NOT EXISTS app;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procurement_user') THEN
    CREATE ROLE procurement_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- Sends queued notifications. Sees the outbox and nothing else.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procurement_mailer') THEN
    CREATE ROLE procurement_mailer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- Logs people in and looks up sessions. The only role that may call the
  -- functions handing out password hashes and creating sessions.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procurement_auth') THEN
    CREATE ROLE procurement_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

CREATE FUNCTION app.schema_version() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 2';

-- Same characters as trimText() in src/core/intake.ts.
CREATE FUNCTION app.trim_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(p, '^[ \t\n\r\f\v　]+|[ \t\n\r\f\v　]+$', '', 'g')
$$;

-- Choice options: 1 to 60 characters each, no repeats.
CREATE FUNCTION app.options_ok(p text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(bool_and(o IS NOT NULL AND length(o) BETWEEN 1 AND 60), true)
         AND (SELECT count(DISTINCT o) FROM unnest(p) o) = cardinality(p)
    FROM unnest(p) o
$$;

-- B社 (the organization, `name`) serves one client company, A社 (`client_name`).
CREATE TABLE app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 100),
  -- B社's receiving address, for deliveries via B社.
  address text CHECK (length(address) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A社's branches (拠点).
CREATE TABLE app.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{1,20}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  address text CHECK (length(address) <= 200),
  UNIQUE (org_id, code),
  UNIQUE (org_id, id)
);

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1 AND length(email) <= 200),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- client: A社 staff of one branch. agent: B社 purchasing staff.
-- admin: an agent who also manages the intake form, catalog sources and members
-- and reads the whole audit log.
CREATE TABLE app.memberships (
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  user_id uuid NOT NULL REFERENCES app.users(id),
  role text NOT NULL CHECK (role IN ('client', 'agent', 'admin')),
  store_id uuid,
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id, store_id) REFERENCES app.stores (org_id, id),
  CHECK ((role = 'client') = (store_id IS NOT NULL))
);

CREATE TABLE app.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  expires_at timestamptz NOT NULL
);

-- Catalog (B社 only) -------------------------------------------------------------

-- A maker's catalog from its own web site (structured product data on the
-- pages) or from a CSV file it provides.
CREATE TABLE app.catalog_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('site', 'csv')),
  urls text[] NOT NULL DEFAULT '{}' CHECK (cardinality(urls) <= 20),
  prices_include_tax boolean NOT NULL DEFAULT false,
  default_tax_rate smallint NOT NULL DEFAULT 10 CHECK (default_tax_rate IN (8, 10)),
  last_import jsonb,
  imported_at timestamptz,
  created_by uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

-- Product images copied from the maker at import time, so pages never load
-- third-party content. PNG, JPEG, WebP and GIF only (checked by magic bytes).
CREATE TABLE app.catalog_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1048576),
  UNIQUE (org_id, sha256),
  UNIQUE (org_id, id)
);

CREATE TABLE app.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  source_id uuid NOT NULL,
  -- SKU when the maker publishes one, otherwise the product page URL.
  external_key text NOT NULL CHECK (length(external_key) BETWEEN 1 AND 500),
  sku text CHECK (length(sku) <= 100),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  brand text CHECK (length(brand) <= 100),
  category text CHECK (length(category) <= 100),
  description text CHECK (length(description) <= 1000),
  unit text NOT NULL DEFAULT '個' CHECK (length(unit) BETWEEN 1 AND 20),
  -- The price as the maker lists it, and whether that includes tax.
  listed_price integer NOT NULL CHECK (listed_price BETWEEN 0 AND 100000000),
  price_includes_tax boolean NOT NULL,
  tax_rate smallint NOT NULL CHECK (tax_rate IN (8, 10)),
  -- Reference unit price before tax, computed by catalog_item_price().
  unit_price integer NOT NULL DEFAULT 0 CHECK (unit_price BETWEEN 0 AND 100000000),
  product_url text CHECK (product_url ~ '^https?://' AND length(product_url) <= 2000),
  image_id uuid,
  -- available: found in the latest import. active: B社 uses it.
  available boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, source_id) REFERENCES app.catalog_sources (org_id, id),
  FOREIGN KEY (org_id, image_id) REFERENCES app.catalog_images (org_id, id),
  UNIQUE (source_id, external_key),
  UNIQUE (org_id, id)
);
CREATE INDEX catalog_items_listing ON app.catalog_items (org_id, source_id, category, name);

-- Intake form (規定フォーマット) ------------------------------------------------------

-- The questions every request answers. B社 admins edit them; fields are
-- deactivated, never deleted. Requests keep a snapshot of their answers.
CREATE TABLE app.request_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('text', 'textarea', 'number', 'date', 'choice', 'url')),
  required boolean NOT NULL DEFAULT false,
  options text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(options) <= 20 AND app.options_ok(options)),
  help text NOT NULL DEFAULT '' CHECK (length(help) <= 200),
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 100000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'choice') = (cardinality(options) > 0)),
  UNIQUE (org_id, key),
  UNIQUE (org_id, id)
);

-- Makers (B社 only) -----------------------------------------------------------------

CREATE TABLE app.makers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  contact_name text CHECK (length(contact_name) <= 100),
  email text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1 AND length(email) <= 200),
  phone text CHECK (length(phone) <= 30),
  note text CHECK (length(note) <= 1000),
  -- The maker's product catalog, imported from its site or a CSV.
  catalog_source_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, catalog_source_id) REFERENCES app.catalog_sources (org_id, id),
  UNIQUE (org_id, id)
);

-- Orders -----------------------------------------------------------------------

CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  store_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'requested', 'hearing', 'sourcing', 'quoted', 'agreed',
                      'ordered', 'scheduled', 'rejected', 'cancelled')),
  request_number text,
  po_number text,
  created_by uuid NOT NULL REFERENCES app.users(id),
  requested_at timestamptz,
  title text CHECK (length(title) <= 100),
  -- Snapshot of the intake form: [{key, label, kind, value}], written by
  -- app.normalize_answers() when the request is sent.
  answers jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(answers) = 'array' AND octet_length(answers::text) <= 100000),
  needed_by date,
  note text CHECK (length(note) <= 1000),
  current_quote_id uuid,
  revision_note text CHECK (length(revision_note) <= 1000),
  reject_reason text CHECK (length(reject_reason) <= 1000),
  cancel_reason text CHECK (length(cancel_reason) <= 1000),
  agreed_at timestamptz,
  agreed_total bigint,
  ordered_at timestamptz,
  delivery_mode text CHECK (delivery_mode IN ('direct', 'via_agent')),
  delivery_note text CHECK (length(delivery_note) <= 500),
  delivery_date date,
  scheduled_at timestamptz,
  -- The B社 agent who placed the order (A社's contact from then on).
  assigned_to uuid REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, store_id) REFERENCES app.stores (org_id, id),
  UNIQUE (org_id, request_number),
  UNIQUE (org_id, po_number),
  UNIQUE (org_id, id)
);
CREATE INDEX orders_org_status ON app.orders (org_id, status, updated_at DESC);
CREATE INDEX orders_store ON app.orders (org_id, store_id, updated_at DESC);

-- Hearing: B社's questions, A社's answers, and B社's own notes (never shown to A社).
CREATE TABLE app.order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES app.users(id),
  kind text NOT NULL CHECK (kind IN ('question', 'answer', 'note')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, order_id) REFERENCES app.orders (org_id, id)
);
CREATE INDEX order_messages_order ON app.order_messages (order_id, created_at);

-- The product outline (商品概要) B社 fixes before asking makers.
CREATE TABLE app.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 100000),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  spec text NOT NULL DEFAULT '' CHECK (length(spec) <= 500),
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 9999),
  -- Filled by order_line_guard(): from the catalog item when linked, else 個 / 10%.
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 20),
  tax_rate smallint NOT NULL CHECK (tax_rate IN (8, 10)),
  item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, order_id) REFERENCES app.orders (org_id, id),
  FOREIGN KEY (org_id, item_id) REFERENCES app.catalog_items (org_id, id),
  UNIQUE (org_id, id)
);
CREATE INDEX order_lines_order ON app.order_lines (order_id, position);

-- A request for a quote to one maker, and its reply (B社 only). Several makers
-- can be asked for the same request (相見積).
CREATE TABLE app.maker_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  maker_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'received', 'declined', 'withdrawn')),
  requested_by uuid NOT NULL REFERENCES app.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  -- [{order_line_id, unit_cost, stock}] in outline order, one per outline line.
  lines jsonb NOT NULL DEFAULT '[]',
  shipping_cost integer NOT NULL DEFAULT 0 CHECK (shipping_cost BETWEEN 0 AND 10000000),
  lead_time text CHECK (length(lead_time) <= 100),
  valid_until date,
  note text CHECK (length(note) <= 1000),
  -- Σ unit_cost × qty + shipping_cost, computed by maker_quote_guard().
  cost_subtotal bigint,
  FOREIGN KEY (org_id, order_id) REFERENCES app.orders (org_id, id),
  FOREIGN KEY (org_id, maker_id) REFERENCES app.makers (org_id, id),
  UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX maker_quotes_one_open ON app.maker_quotes (order_id, maker_id)
  WHERE status IN ('requested', 'received');

-- A quote to A社: selling prices only. Immutable once issued (by
-- app.issue_quote); only the response columns change, once.
CREATE TABLE app.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'superseded', 'accepted', 'declined')),
  -- [{line_no, order_line_id, name, spec, unit, tax_rate, qty, unit_price, amount}]
  lines jsonb NOT NULL,
  shipping_fee integer NOT NULL DEFAULT 0 CHECK (shipping_fee BETWEEN 0 AND 10000000),
  expenses integer NOT NULL DEFAULT 0 CHECK (expenses BETWEEN 0 AND 10000000),
  subtotal_10 bigint NOT NULL,
  tax_10 bigint NOT NULL,
  subtotal_8 bigint NOT NULL,
  tax_8 bigint NOT NULL,
  total bigint NOT NULL,
  valid_until date NOT NULL,
  note text CHECK (length(note) <= 1000),
  issued_by uuid NOT NULL REFERENCES app.users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  responded_by uuid REFERENCES app.users(id),
  responded_at timestamptz,
  response_note text CHECK (length(response_note) <= 1000),
  FOREIGN KEY (org_id, order_id) REFERENCES app.orders (org_id, id),
  UNIQUE (order_id, version),
  UNIQUE (org_id, id)
);
ALTER TABLE app.orders
  ADD FOREIGN KEY (org_id, current_quote_id) REFERENCES app.quotes (org_id, id);

-- What a quote cost B社 and earned it (B社 only), 1:1 with quotes.
CREATE TABLE app.quote_costs (
  quote_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  maker_quote_id uuid NOT NULL,
  pricing_mode text NOT NULL CHECK (pricing_mode IN ('markup', 'price')),
  markup_bp integer CHECK (markup_bp BETWEEN 0 AND 30000),
  -- [{order_line_id, unit_cost, unit_price, qty, cost_amount, sales_amount, profit}]
  lines jsonb NOT NULL,
  cost_subtotal bigint NOT NULL,
  sales_subtotal bigint NOT NULL,
  profit bigint NOT NULL,
  CHECK ((pricing_mode = 'markup') = (markup_bp IS NOT NULL)),
  FOREIGN KEY (org_id, quote_id) REFERENCES app.quotes (org_id, id),
  FOREIGN KEY (org_id, maker_quote_id) REFERENCES app.maker_quotes (org_id, id)
);

-- Transactional outbox: written by trigger in the same transaction as the
-- change it reports, then delivered by the mailer (at least once).
CREATE TABLE app.outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('requested', 'question', 'answered', 'rfq', 'quoted', 'revision',
                                       'agreed', 'ordered', 'scheduled', 'rejected', 'cancelled')),
  audience text NOT NULL CHECK (audience IN ('client', 'agent', 'maker')),
  to_user_id uuid REFERENCES app.users(id),
  to_email text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'demo')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  FOREIGN KEY (org_id, order_id) REFERENCES app.orders (org_id, id)
);
CREATE INDEX outbox_due ON app.outbox (status, next_attempt_at);
CREATE INDEX outbox_recipient ON app.outbox (org_id, to_user_id, id DESC);

-- agent_only: rows about makers, maker quotes and B社 notes, which A社 staff
-- never read even for their own requests. Details never carry cost figures.
CREATE TABLE app.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid,
  actor_id uuid REFERENCES app.users(id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  agent_only boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_at ON app.audit_log (org_id, at DESC);
CREATE INDEX audit_order ON app.audit_log (order_id, id);

-- Gapless yearly numbering (Japan time) for requests and purchase orders.
CREATE TABLE app.counters (
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  kind text NOT NULL CHECK (kind IN ('request', 'po')),
  year integer NOT NULL,
  value integer NOT NULL,
  PRIMARY KEY (org_id, kind, year)
);

-- Request context ------------------------------------------------------------

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- SECURITY DEFINER so policies can read memberships without recursion.
CREATE FUNCTION app.current_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT role FROM app.memberships
  WHERE org_id = app.current_org_id() AND user_id = app.current_user_id()
$$;

CREATE FUNCTION app.current_store_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT store_id FROM app.memberships
  WHERE org_id = app.current_org_id() AND user_id = app.current_user_id()
$$;

-- B社: an agent or an admin.
CREATE FUNCTION app.is_agent() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.current_role() IN ('agent', 'admin'), false)
$$;

CREATE FUNCTION app.today_jst() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Tokyo')::date
$$;

-- Amounts ----------------------------------------------------------------------
-- Same rules as src/core/money.ts (tests compare the two).

-- Consumption tax on the subtotal of one rate, rounded down once per document
-- and per rate (the qualified invoice rule).
CREATE FUNCTION app.tax_amount(p_subtotal bigint, p_rate integer) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_subtotal * p_rate) / 100
$$;

-- Price before tax from a tax-inclusive price, rounded up (the smallest
-- pre-tax price whose tax-inclusive price, rounded down, is not below it).
CREATE FUNCTION app.price_before_tax(p_price integer, p_includes_tax boolean, p_rate integer)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_includes_tax
              THEN ((p_price::bigint * 100 + (100 + p_rate) - 1) / (100 + p_rate))::integer
              ELSE p_price END
$$;

-- Selling price from a unit cost and a markup in basis points, rounded up:
-- ceil(cost × (10000 + bp) / 10000).
CREATE FUNCTION app.selling_price(p_cost bigint, p_bp integer) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_cost * (10000 + p_bp) + 9999) / 10000
$$;

-- Row-level security ----------------------------------------------------------

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.request_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.makers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.maker_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quote_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_read ON app.organizations FOR SELECT TO procurement_user
  USING (id = app.current_org_id() AND app.current_role() IS NOT NULL);

-- A社 staff see their own branch; B社 sees every branch.
CREATE POLICY stores_read ON app.stores FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id()
         AND (app.is_agent() OR id = app.current_store_id()));

-- A社 staff see their colleagues and B社, not other branches' staff.
CREATE POLICY members_read ON app.memberships FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
         AND (app.is_agent() OR role IN ('agent', 'admin') OR store_id = app.current_store_id()));

CREATE POLICY users_read ON app.users FOR SELECT TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.memberships m WHERE m.user_id = users.id));

-- The catalog is B社's working tool; admins manage it.
CREATE POLICY sources_read ON app.catalog_sources FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY sources_insert ON app.catalog_sources FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin'
              AND created_by = app.current_user_id());
CREATE POLICY sources_update ON app.catalog_sources FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin')
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY images_read ON app.catalog_images FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY images_insert ON app.catalog_images FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin');

CREATE POLICY items_read ON app.catalog_items FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY items_insert ON app.catalog_items FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin');
CREATE POLICY items_update ON app.catalog_items FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin')
  WITH CHECK (org_id = app.current_org_id());

-- Everyone reads the active form; B社 also sees deactivated fields; admins edit.
CREATE POLICY fields_read ON app.request_fields FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
         AND (active OR app.is_agent()));
CREATE POLICY fields_insert ON app.request_fields FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin');
CREATE POLICY fields_update ON app.request_fields FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin')
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY makers_read ON app.makers FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY makers_insert ON app.makers FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY makers_update ON app.makers FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent())
  WITH CHECK (org_id = app.current_org_id());

-- B社 sees every branch's requests but no drafts. A社 staff see their branch's
-- requests and their own drafts.
CREATE POLICY orders_read ON app.orders FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND (
           (app.is_agent() AND status <> 'draft')
           OR (app.current_role() = 'client' AND store_id = app.current_store_id()
               AND (status <> 'draft' OR created_by = app.current_user_id()))));
CREATE POLICY orders_insert ON app.orders FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'client'
              AND store_id = app.current_store_id()
              AND created_by = app.current_user_id() AND status = 'draft');
CREATE POLICY orders_update ON app.orders FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND (
           (app.is_agent() AND status <> 'draft')
           OR (app.current_role() = 'client' AND store_id = app.current_store_id()
               AND (status <> 'draft' OR created_by = app.current_user_id()))))
  WITH CHECK (org_id = app.current_org_id());

-- Questions and answers for whoever sees the request; notes for B社 only.
CREATE POLICY messages_read ON app.order_messages FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id()
         AND (app.is_agent() OR kind <> 'note')
         AND EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_messages.order_id));
CREATE POLICY messages_insert ON app.order_messages FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND author_id = app.current_user_id());

-- A社 sees the outline once B社 has fixed it.
CREATE POLICY lines_read ON app.order_lines FOR SELECT TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_lines.order_id
                   AND (app.is_agent()
                        OR o.status IN ('sourcing', 'quoted', 'agreed', 'ordered', 'scheduled'))));
CREATE POLICY lines_insert ON app.order_lines FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY lines_update ON app.order_lines FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent())
  WITH CHECK (org_id = app.current_org_id());
CREATE POLICY lines_delete ON app.order_lines FOR DELETE TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());

CREATE POLICY maker_quotes_read ON app.maker_quotes FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY maker_quotes_insert ON app.maker_quotes FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.is_agent());
CREATE POLICY maker_quotes_update ON app.maker_quotes FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent())
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY quotes_read ON app.quotes FOR SELECT TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = quotes.order_id));
CREATE POLICY quotes_update ON app.quotes FOR UPDATE TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = quotes.order_id))
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY quote_costs_read ON app.quote_costs FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.is_agent());

-- People read the notifications addressed to them; B社 also reads what went
-- to makers.
CREATE POLICY outbox_read ON app.outbox FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
         AND (to_user_id = app.current_user_id() OR (audience = 'maker' AND app.is_agent())));
CREATE POLICY outbox_mailer ON app.outbox FOR ALL TO procurement_mailer
  USING (true) WITH CHECK (true);

CREATE POLICY audit_read ON app.audit_log FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id()
         AND (app.current_role() = 'admin'
              OR (order_id IS NOT NULL
                  AND (app.is_agent() OR NOT agent_only)
                  AND EXISTS (SELECT 1 FROM app.orders o WHERE o.id = audit_log.order_id))));

-- procurement_user gets only what the policies above need: no DELETE except
-- outline lines, no INSERT on quotes or quote_costs (app.issue_quote only),
-- and nothing at all on sessions, counters or password hashes.
GRANT USAGE ON SCHEMA app TO procurement_user, procurement_mailer;
GRANT SELECT (id, email, name, created_at) ON app.users TO procurement_user;
GRANT SELECT ON app.organizations, app.stores, app.memberships, app.catalog_sources,
  app.catalog_images, app.catalog_items, app.request_fields, app.makers, app.orders,
  app.order_messages, app.order_lines, app.maker_quotes, app.quotes, app.quote_costs,
  app.outbox, app.audit_log TO procurement_user;
GRANT INSERT ON app.catalog_sources, app.catalog_images, app.catalog_items, app.request_fields,
  app.makers, app.orders, app.order_messages, app.order_lines TO procurement_user;
GRANT INSERT (org_id, order_id, maker_id) ON app.maker_quotes TO procurement_user;
GRANT UPDATE (name, urls, prices_include_tax, default_tax_rate, last_import, imported_at)
  ON app.catalog_sources TO procurement_user;
GRANT UPDATE (sku, name, brand, category, description, unit, listed_price, price_includes_tax,
  tax_rate, product_url, image_id, available, active, seen_at) ON app.catalog_items TO procurement_user;
GRANT UPDATE (label, kind, required, options, help, position, active) ON app.request_fields
  TO procurement_user;
GRANT UPDATE (name, contact_name, email, phone, note, catalog_source_id, active) ON app.makers
  TO procurement_user;
GRANT UPDATE (status, title, answers, needed_by, note, revision_note, reject_reason, cancel_reason,
  delivery_mode, delivery_note, delivery_date) ON app.orders TO procurement_user;
GRANT UPDATE (position, name, spec, qty, unit, tax_rate) ON app.order_lines TO procurement_user;
GRANT DELETE ON app.order_lines TO procurement_user;
GRANT UPDATE (status, lines, shipping_cost, lead_time, valid_until, note) ON app.maker_quotes
  TO procurement_user;
GRANT UPDATE (status, responded_by, response_note) ON app.quotes TO procurement_user;
GRANT SELECT, UPDATE (status, attempts, last_error, next_attempt_at, sent_at) ON app.outbox
  TO procurement_mailer;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_org_id(), app.current_role(),
  app.current_store_id(), app.is_agent(), app.today_jst(), app.tax_amount(bigint, integer),
  app.price_before_tax(integer, boolean, integer), app.selling_price(bigint, integer),
  app.schema_version(), app.trim_text(text) TO procurement_user;

-- Catalog -------------------------------------------------------------------------

CREATE FUNCTION app.catalog_item_price() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.unit_price := app.price_before_tax(NEW.listed_price, NEW.price_includes_tax, NEW.tax_rate);
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.source_id <> OLD.source_id
                           OR NEW.external_key <> OLD.external_key) THEN
    RAISE EXCEPTION 'immutable catalog columns' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_item_price BEFORE INSERT OR UPDATE ON app.catalog_items
  FOR EACH ROW EXECUTE FUNCTION app.catalog_item_price();

CREATE FUNCTION app.maker_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER maker_touch BEFORE INSERT OR UPDATE ON app.makers
  FOR EACH ROW EXECUTE FUNCTION app.maker_touch();

-- Intake answers ------------------------------------------------------------------

-- Check a request's answers against the active intake fields and return the
-- snapshot to store: in form order, label and kind from the form (never the
-- caller's), values trimmed, empty optional answers left out. Same rules as
-- validateAnswers() in src/core/intake.ts. Runs as the caller.
CREATE FUNCTION app.normalize_answers(p_org uuid, p_answers jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f app.request_fields;
  e jsonb;
  v jsonb;
  s text;
  n numeric;
  d date;
  given jsonb := '{}';
  out jsonb := '[]';
BEGIN
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'array' OR jsonb_array_length(p_answers) > 200 THEN
    RAISE EXCEPTION 'answers must be a list' USING ERRCODE = '23514';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_answers) LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'key') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'malformed answer' USING ERRCODE = '23514';
    END IF;
    IF given ? (e->>'key') THEN
      RAISE EXCEPTION 'duplicate answer %', e->>'key' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.request_fields
                    WHERE org_id = p_org AND key = e->>'key' AND active) THEN
      RAISE EXCEPTION 'unknown answer %', e->>'key' USING ERRCODE = '23514';
    END IF;
    given := given || jsonb_build_object(e->>'key', coalesce(e->'value', 'null'::jsonb));
  END LOOP;

  FOR f IN SELECT * FROM app.request_fields WHERE org_id = p_org AND active
           ORDER BY position, created_at, key LOOP
    v := given->f.key;
    IF v IS NULL OR jsonb_typeof(v) = 'null'
       OR (jsonb_typeof(v) = 'string' AND app.trim_text(v #>> '{}') = '') THEN
      IF f.required THEN
        RAISE EXCEPTION 'answer % is required', f.key USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;
    IF f.kind = 'number' THEN
      IF jsonb_typeof(v) <> 'number' THEN
        RAISE EXCEPTION 'answer % must be a whole number', f.key USING ERRCODE = '23514';
      END IF;
      n := (v #>> '{}')::numeric;
      IF n <> trunc(n) OR n < 0 OR n > 100000000 THEN
        RAISE EXCEPTION 'answer % must be a whole number', f.key USING ERRCODE = '23514';
      END IF;
      v := to_jsonb(n::bigint);
    ELSE
      IF jsonb_typeof(v) <> 'string' THEN
        RAISE EXCEPTION 'answer % must be text', f.key USING ERRCODE = '23514';
      END IF;
      s := app.trim_text(v #>> '{}');
      CASE f.kind
        WHEN 'text' THEN
          IF length(s) > 200 THEN
            RAISE EXCEPTION 'answer % is too long', f.key USING ERRCODE = '23514';
          END IF;
        WHEN 'textarea' THEN
          IF length(s) > 2000 THEN
            RAISE EXCEPTION 'answer % is too long', f.key USING ERRCODE = '23514';
          END IF;
        WHEN 'url' THEN
          IF s !~ '^https?://\S+$' OR length(s) > 2000 THEN
            RAISE EXCEPTION 'answer % must be a web address', f.key USING ERRCODE = '23514';
          END IF;
        WHEN 'date' THEN
          d := NULL;
          IF s ~ '^\d{4}-\d{2}-\d{2}$' THEN
            BEGIN
              d := s::date;
            EXCEPTION WHEN others THEN
              d := NULL;
            END;
          END IF;
          IF d IS NULL OR to_char(d, 'YYYY-MM-DD') <> s THEN
            RAISE EXCEPTION 'answer % must be a date', f.key USING ERRCODE = '23514';
          END IF;
        WHEN 'choice' THEN
          IF NOT (s = ANY (f.options)) THEN
            RAISE EXCEPTION 'answer % is not one of the choices', f.key USING ERRCODE = '23514';
          END IF;
      END CASE;
      v := to_jsonb(s);
    END IF;
    out := out || jsonb_build_array(jsonb_build_object('key', f.key, 'label', f.label, 'kind', f.kind, 'value', v));
  END LOOP;
  RETURN out;
END $$;

-- Order workflow ------------------------------------------------------------------

-- Who may move an order from one status to another. Runs as the caller, so the
-- row-level security above applies to every lookup it makes (except inside
-- app.issue_quote, which checks the caller before it updates the order).
CREATE FUNCTION app.order_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r text := app.current_role();
  me uuid := app.current_user_id();
  agent boolean := coalesce(app.current_role() IN ('agent', 'admin'), false);
  own_store boolean := coalesce(app.current_role() = 'client' AND OLD.store_id = app.current_store_id(), false);
  q app.quotes;
BEGIN
  IF r IS NULL THEN
    RAISE EXCEPTION 'not a member of this organization' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id <> OLD.org_id OR NEW.store_id <> OLD.store_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR ROW(NEW.request_number, NEW.po_number, NEW.requested_at, NEW.agreed_at, NEW.agreed_total,
            NEW.ordered_at, NEW.scheduled_at, NEW.assigned_to)
        IS DISTINCT FROM ROW(OLD.request_number, OLD.po_number, OLD.requested_at, OLD.agreed_at,
            OLD.agreed_total, OLD.ordered_at, OLD.scheduled_at, OLD.assigned_to) THEN
    RAISE EXCEPTION 'immutable order columns' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('scheduled', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'order is closed' USING ERRCODE = '42501';
  END IF;
  IF ROW(NEW.title, NEW.answers, NEW.needed_by, NEW.note)
     IS DISTINCT FROM ROW(OLD.title, OLD.answers, OLD.needed_by, OLD.note)
     AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'request details are locked once sent' USING ERRCODE = '42501';
  END IF;
  -- Each workflow column changes only in the transition that owns it.
  IF (NEW.revision_note IS DISTINCT FROM OLD.revision_note
      AND NOT (OLD.status = 'quoted' AND NEW.status = 'sourcing'))
     OR (NEW.reject_reason IS DISTINCT FROM OLD.reject_reason AND NEW.status <> 'rejected')
     OR (NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason AND NEW.status <> 'cancelled')
     OR (NEW.current_quote_id IS DISTINCT FROM OLD.current_quote_id AND NEW.status <> 'quoted')
     OR (ROW(NEW.delivery_mode, NEW.delivery_note) IS DISTINCT FROM ROW(OLD.delivery_mode, OLD.delivery_note)
         AND NOT (OLD.status = 'agreed' AND NEW.status = 'ordered'))
     OR (NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
         AND NOT (OLD.status = 'ordered' AND NEW.status = 'scheduled')) THEN
    RAISE EXCEPTION 'workflow columns change only with their transition' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = OLD.status THEN
    IF OLD.status = 'draft' THEN
      IF OLD.created_by <> me THEN
        RAISE EXCEPTION 'only the author edits a draft' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'quoted' AND NEW.current_quote_id IS DISTINCT FROM OLD.current_quote_id THEN
      NULL; -- a revised quote, checked below
    ELSIF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'nothing to change in status %', OLD.status USING ERRCODE = '42501';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  CASE
    WHEN OLD.status = 'draft' AND NEW.status = 'requested' THEN
      IF OLD.created_by <> me THEN
        RAISE EXCEPTION 'only the author sends a draft' USING ERRCODE = '42501';
      END IF;
      NEW.title := app.trim_text(NEW.title);
      IF coalesce(length(NEW.title), 0) = 0 THEN
        RAISE EXCEPTION 'a request needs a title' USING ERRCODE = '23514';
      END IF;
      NEW.answers := app.normalize_answers(NEW.org_id, NEW.answers);
      IF NEW.needed_by IS NOT NULL AND NEW.needed_by < app.today_jst() THEN
        RAISE EXCEPTION 'the needed-by date is in the past' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status = 'requested' AND NEW.status = 'hearing' THEN
      -- Only by posting a question (app.message_posted), in this transaction.
      IF NOT agent OR NOT EXISTS (SELECT 1 FROM app.order_messages
                                   WHERE order_id = NEW.id AND kind = 'question'
                                     AND author_id = me AND created_at = now()) THEN
        RAISE EXCEPTION 'a hearing starts with a question from the agent' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'hearing' AND NEW.status = 'requested' THEN
      IF NOT own_store OR NOT EXISTS (SELECT 1 FROM app.order_messages
                                       WHERE order_id = NEW.id AND kind = 'answer'
                                         AND author_id = me AND created_at = now()) THEN
        RAISE EXCEPTION 'the branch answers the question' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'requested' AND NEW.status = 'sourcing' THEN
      IF NOT agent THEN
        RAISE EXCEPTION 'only the agent fixes the outline' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM app.order_lines WHERE order_id = NEW.id) THEN
        RAISE EXCEPTION 'the outline needs at least one line' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status = 'sourcing' AND NEW.status = 'requested' THEN
      IF NOT agent THEN
        RAISE EXCEPTION 'only the agent reopens the outline' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status IN ('sourcing', 'quoted') AND NEW.status = 'quoted' THEN
      -- Only app.issue_quote creates quotes (and their costs); it points the
      -- order at the newest one.
      IF NOT agent THEN
        RAISE EXCEPTION 'only the agent quotes' USING ERRCODE = '42501';
      END IF;
      SELECT * INTO q FROM app.quotes WHERE id = NEW.current_quote_id;
      IF q.id IS NULL OR q.order_id <> NEW.id OR q.status <> 'sent'
         OR q.version <> (SELECT max(version) FROM app.quotes WHERE order_id = NEW.id)
         OR NOT EXISTS (SELECT 1 FROM app.quote_costs WHERE quote_id = q.id) THEN
        RAISE EXCEPTION 'the current quote must be the latest one issued' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM app.quotes WHERE order_id = NEW.id AND status = 'sent' AND id <> q.id) THEN
        RAISE EXCEPTION 'an earlier quote is still open' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'quoted' AND NEW.status = 'sourcing' THEN
      SELECT * INTO q FROM app.quotes WHERE id = OLD.current_quote_id;
      IF NOT own_store OR q.status IS DISTINCT FROM 'declined' OR q.responded_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'only the branch asks for a revision of its quote' USING ERRCODE = '42501';
      END IF;
      IF coalesce(length(app.trim_text(NEW.revision_note)), 0) = 0 THEN
        RAISE EXCEPTION 'a revision request needs a note' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status = 'quoted' AND NEW.status = 'agreed' THEN
      -- A社's signature: the branch accepted the current quote.
      SELECT * INTO q FROM app.quotes WHERE id = OLD.current_quote_id;
      IF NOT own_store OR q.status IS DISTINCT FROM 'accepted' OR q.responded_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'an agreement needs the branch to accept the current quote' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'agreed' AND NEW.status = 'ordered' THEN
      IF NOT agent THEN
        RAISE EXCEPTION 'only the agent places the order' USING ERRCODE = '42501';
      END IF;
      IF NEW.delivery_mode IS NULL THEN
        RAISE EXCEPTION 'an order needs a delivery mode' USING ERRCODE = '23514';
      END IF;
      NEW.delivery_note := nullif(app.trim_text(NEW.delivery_note), '');
    WHEN OLD.status = 'ordered' AND NEW.status = 'scheduled' THEN
      IF NOT agent THEN
        RAISE EXCEPTION 'only the agent fixes the delivery date' USING ERRCODE = '42501';
      END IF;
      IF NEW.delivery_date IS NULL OR NEW.delivery_date < app.today_jst() THEN
        RAISE EXCEPTION 'the delivery date must be today or later' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status IN ('requested', 'hearing', 'sourcing') AND NEW.status = 'rejected' THEN
      IF NOT agent THEN
        RAISE EXCEPTION 'only the agent declines a request' USING ERRCODE = '42501';
      END IF;
      IF coalesce(length(app.trim_text(NEW.reject_reason)), 0) = 0 THEN
        RAISE EXCEPTION 'a rejection needs a reason' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status IN ('requested', 'hearing', 'sourcing', 'quoted') AND NEW.status = 'cancelled' THEN
      IF NOT own_store THEN
        RAISE EXCEPTION 'only the branch withdraws its request' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END CASE;
  RETURN NEW;
END $$;

-- Numbers, timestamps, the agreed amount and the assignee are set here, never
-- by the caller (procurement_user cannot even name those columns in an UPDATE).
CREATE FUNCTION app.order_numbering() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_year integer := extract(year FROM now() AT TIME ZONE 'Asia/Tokyo')::integer;
  v_kind text;
  n integer;
BEGIN
  NEW.updated_at := now();
  IF OLD.status = 'quoted' AND NEW.status = 'agreed' THEN
    NEW.agreed_at := now();
    NEW.agreed_total := (SELECT total FROM app.quotes WHERE id = NEW.current_quote_id);
    RETURN NEW;
  ELSIF OLD.status = 'ordered' AND NEW.status = 'scheduled' THEN
    NEW.scheduled_at := now();
    RETURN NEW;
  ELSIF OLD.status = 'draft' AND NEW.status = 'requested' THEN
    v_kind := 'request';
  ELSIF OLD.status = 'agreed' AND NEW.status = 'ordered' THEN
    v_kind := 'po';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO app.counters AS c (org_id, kind, year, value) VALUES (NEW.org_id, v_kind, v_year, 1)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET value = c.value + 1
  RETURNING c.value INTO n;
  IF v_kind = 'request' THEN
    NEW.request_number := 'R-' || v_year || '-' || lpad(n::text, 4, '0');
    NEW.requested_at := now();
  ELSE
    NEW.po_number := 'PO-' || v_year || '-' || lpad(n::text, 4, '0');
    NEW.ordered_at := now();
    NEW.assigned_to := app.current_user_id();
  END IF;
  RETURN NEW;
END $$;

-- BEFORE triggers run in name order: the guard sees the caller's values, then
-- numbering fills in the rest.
CREATE TRIGGER order_10_guard BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_guard();
CREATE TRIGGER order_20_numbering BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_numbering();

CREATE FUNCTION app.order_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'draft'
     OR ROW(NEW.request_number, NEW.po_number, NEW.current_quote_id, NEW.requested_at,
            NEW.revision_note, NEW.reject_reason, NEW.cancel_reason, NEW.agreed_at, NEW.agreed_total,
            NEW.ordered_at, NEW.delivery_mode, NEW.delivery_note, NEW.delivery_date, NEW.scheduled_at,
            NEW.assigned_to) IS DISTINCT FROM
        ROW(NULL::text, NULL::text, NULL::uuid, NULL::timestamptz, NULL::text, NULL::text, NULL::text,
            NULL::timestamptz, NULL::bigint, NULL::timestamptz, NULL::text, NULL::text, NULL::date,
            NULL::timestamptz, NULL::uuid) THEN
    RAISE EXCEPTION 'a new order starts as an empty draft' USING ERRCODE = '42501';
  END IF;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER order_insert BEFORE INSERT ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_insert();

-- Reopening the outline withdraws the open maker quotes, in the same statement
-- and as the caller (app.maker_quote_guard checks it).
CREATE FUNCTION app.order_reopened() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'sourcing' AND NEW.status = 'requested' THEN
    UPDATE app.maker_quotes SET status = 'withdrawn'
     WHERE order_id = NEW.id AND status IN ('requested', 'received');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER order_reopened AFTER UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_reopened();

-- Declining or withdrawing a request closes its open maker quotes in the same
-- transaction. SECURITY DEFINER because A社 withdraws requests and cannot see
-- maker quotes; app.order_guard has already checked who closed the request,
-- and app.maker_quote_guard accepts this change only from a trigger on a
-- closed request. No mail goes to the makers.
CREATE FUNCTION app.order_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  UPDATE app.maker_quotes SET status = 'withdrawn'
   WHERE order_id = NEW.id AND status IN ('requested', 'received');
  RETURN NULL;
END $$;
CREATE TRIGGER order_quotes_closed AFTER UPDATE ON app.orders
  FOR EACH ROW WHEN (NEW.status IN ('rejected', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app.order_closed();

-- Hearing -------------------------------------------------------------------------

CREATE FUNCTION app.message_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o app.orders;
  agent boolean := app.is_agent();
BEGIN
  SELECT * INTO o FROM app.orders WHERE id = NEW.order_id;
  IF o.id IS NULL OR o.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = '42501';
  END IF;
  NEW.author_id := app.current_user_id();
  NEW.created_at := now();
  NEW.body := app.trim_text(NEW.body);
  IF coalesce(NEW.body, '') = '' THEN
    RAISE EXCEPTION 'a message needs text' USING ERRCODE = '23514';
  END IF;
  CASE NEW.kind
    WHEN 'question' THEN
      IF NOT agent OR o.status <> 'requested' THEN
        RAISE EXCEPTION 'the agent asks while checking the request' USING ERRCODE = '42501';
      END IF;
    WHEN 'answer' THEN
      IF NOT coalesce(app.current_role() = 'client' AND o.store_id = app.current_store_id(), false)
         OR o.status <> 'hearing' THEN
        RAISE EXCEPTION 'the branch answers an open question' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT agent OR o.status IN ('draft', 'scheduled', 'rejected', 'cancelled') THEN
        RAISE EXCEPTION 'agent notes go on open requests' USING ERRCODE = '42501';
      END IF;
  END CASE;
  RETURN NEW;
END $$;
CREATE TRIGGER message_guard BEFORE INSERT ON app.order_messages
  FOR EACH ROW EXECUTE FUNCTION app.message_guard();

-- A question moves the request to the branch, an answer back to B社, as the caller.
CREATE FUNCTION app.message_posted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'question' THEN
    UPDATE app.orders SET status = 'hearing' WHERE id = NEW.order_id;
  ELSIF NEW.kind = 'answer' THEN
    UPDATE app.orders SET status = 'requested' WHERE id = NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER message_posted AFTER INSERT ON app.order_messages
  FOR EACH ROW EXECUTE FUNCTION app.message_posted();

-- Outline -------------------------------------------------------------------------

-- B社 writes the outline while it checks the request. A linked catalog item
-- fills the name, unit and tax rate the caller left empty.
CREATE FUNCTION app.order_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o app.orders;
  i app.catalog_items;
BEGIN
  IF NOT app.is_agent() THEN
    RAISE EXCEPTION 'only the agent writes the outline' USING ERRCODE = '42501';
  END IF;
  -- Locked so the outline cannot change while it is being confirmed.
  SELECT * INTO o FROM app.orders
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END FOR SHARE;
  IF o.id IS NULL OR o.status <> 'requested' THEN
    RAISE EXCEPTION 'the outline changes only while the request is being checked' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id <> OLD.order_id OR NEW.org_id <> OLD.org_id
       OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'immutable line columns' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.org_id <> o.org_id THEN
      RAISE EXCEPTION 'order not found' USING ERRCODE = '42501';
    END IF;
    IF NEW.item_id IS NOT NULL THEN
      SELECT * INTO i FROM app.catalog_items WHERE id = NEW.item_id;
      IF i.id IS NULL THEN
        RAISE EXCEPTION 'catalog item not found' USING ERRCODE = '23514';
      END IF;
      NEW.name := coalesce(nullif(app.trim_text(NEW.name), ''), i.name);
      NEW.unit := coalesce(nullif(app.trim_text(NEW.unit), ''), i.unit);
      NEW.tax_rate := coalesce(NEW.tax_rate, i.tax_rate);
    END IF;
    NEW.created_at := now();
  END IF;
  NEW.name := app.trim_text(NEW.name);
  NEW.spec := coalesce(app.trim_text(NEW.spec), '');
  NEW.unit := coalesce(nullif(app.trim_text(NEW.unit), ''), '個');
  NEW.tax_rate := coalesce(NEW.tax_rate, 10);
  RETURN NEW;
END $$;
CREATE TRIGGER order_line_guard BEFORE INSERT OR UPDATE OR DELETE ON app.order_lines
  FOR EACH ROW EXECUTE FUNCTION app.order_line_guard();

-- Maker quotes --------------------------------------------------------------------

-- Asking a maker (insert) and recording its reply (update). Runs as the caller.
CREATE FUNCTION app.maker_quote_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o app.orders;
  m app.makers;
  e jsonb;
  idx bigint;
  cost numeric;
  seen uuid[] := '{}';
  lines_out jsonb;
  sum_cost bigint;
  -- app.order_closed withdrawing the open maker quotes of a declined or
  -- withdrawn request (A社 may be the one who closed it).
  closing boolean := TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND NEW.status = 'withdrawn'
    AND EXISTS (SELECT 1 FROM app.orders
                 WHERE id = NEW.order_id AND status IN ('rejected', 'cancelled'));
BEGIN
  IF NOT app.is_agent() AND NOT closing THEN
    RAISE EXCEPTION 'only the agent deals with makers' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM app.orders
   WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.order_id ELSE OLD.order_id END FOR SHARE;
  IF o.id IS NULL OR o.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF o.status <> 'sourcing' THEN
      RAISE EXCEPTION 'makers are asked once the outline is fixed' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO m FROM app.makers WHERE id = NEW.maker_id AND org_id = NEW.org_id;
    IF m.id IS NULL OR NOT m.active THEN
      RAISE EXCEPTION 'the maker is not active' USING ERRCODE = '23514';
    END IF;
    NEW.status := 'requested';
    NEW.requested_by := app.current_user_id();
    NEW.requested_at := now();
    NEW.answered_at := NULL;
    NEW.lines := '[]';
    NEW.shipping_cost := 0;
    NEW.lead_time := NULL;
    NEW.valid_until := NULL;
    NEW.note := NULL;
    NEW.cost_subtotal := NULL;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.org_id, NEW.order_id, NEW.maker_id, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.org_id, OLD.order_id, OLD.maker_id, OLD.requested_by, OLD.requested_at) THEN
    RAISE EXCEPTION 'immutable maker quote columns' USING ERRCODE = '42501';
  END IF;
  IF OLD.status NOT IN ('requested', 'received') THEN
    RAISE EXCEPTION 'this maker quote is closed' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'requested' AND NEW.status = 'received' THEN
    IF o.status NOT IN ('sourcing', 'quoted') THEN
      RAISE EXCEPTION 'maker replies are recorded while sourcing' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'maker quote lines must match the outline' USING ERRCODE = '23514';
    END IF;
    FOR e, idx IN SELECT value, ordinality FROM jsonb_array_elements(NEW.lines) WITH ORDINALITY LOOP
      IF jsonb_typeof(e) IS DISTINCT FROM 'object'
         OR coalesce(e->>'order_line_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR jsonb_typeof(e->'unit_cost') IS DISTINCT FROM 'number'
         OR coalesce(e->>'stock', '') NOT IN ('in_stock', 'backorder', 'out_of_stock') THEN
        RAISE EXCEPTION 'malformed maker quote line %', idx USING ERRCODE = '23514';
      END IF;
      cost := (e->>'unit_cost')::numeric;
      IF cost <> trunc(cost) OR cost NOT BETWEEN 0 AND 100000000 THEN
        RAISE EXCEPTION 'maker quote line % needs a whole unit cost', idx USING ERRCODE = '23514';
      END IF;
      IF (e->>'order_line_id')::uuid = ANY (seen)
         OR NOT EXISTS (SELECT 1 FROM app.order_lines
                         WHERE id = (e->>'order_line_id')::uuid AND order_id = o.id) THEN
        RAISE EXCEPTION 'maker quote lines must match the outline' USING ERRCODE = '23514';
      END IF;
      seen := seen || (e->>'order_line_id')::uuid;
    END LOOP;
    IF cardinality(seen) <> (SELECT count(*) FROM app.order_lines WHERE order_id = o.id) THEN
      RAISE EXCEPTION 'maker quote lines must match the outline' USING ERRCODE = '23514';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('order_line_id', l.id, 'unit_cost', (x->>'unit_cost')::bigint,
                                        'stock', x->>'stock') ORDER BY l.position, l.created_at, l.id),
           sum((x->>'unit_cost')::bigint * l.qty)
      INTO lines_out, sum_cost
      FROM app.order_lines l
      JOIN jsonb_array_elements(NEW.lines) x ON (x->>'order_line_id')::uuid = l.id
     WHERE l.order_id = o.id;
    IF NEW.valid_until IS NULL OR NEW.valid_until < app.today_jst()
       OR NEW.valid_until > app.today_jst() + 180 THEN
      RAISE EXCEPTION 'maker quote validity must be between today and 180 days' USING ERRCODE = '23514';
    END IF;
    NEW.lines := lines_out;
    NEW.cost_subtotal := sum_cost + NEW.shipping_cost;
    NEW.lead_time := nullif(app.trim_text(NEW.lead_time), '');
    NEW.note := nullif(app.trim_text(NEW.note), '');
    NEW.answered_at := now();
  ELSIF NEW.status IN ('declined', 'withdrawn') THEN
    IF ROW(NEW.lines, NEW.shipping_cost, NEW.lead_time, NEW.valid_until, NEW.cost_subtotal, NEW.answered_at)
       IS DISTINCT FROM ROW(OLD.lines, OLD.shipping_cost, OLD.lead_time, OLD.valid_until,
                            OLD.cost_subtotal, OLD.answered_at) THEN
      RAISE EXCEPTION 'only the status and a note change' USING ERRCODE = '42501';
    END IF;
    IF o.status NOT IN ('sourcing', 'quoted') AND NOT (NEW.status = 'withdrawn' AND o.status = 'requested')
       AND NOT closing THEN
      RAISE EXCEPTION 'maker quotes change while sourcing' USING ERRCODE = '42501';
    END IF;
    IF NOT closing AND EXISTS (SELECT 1 FROM app.quotes q JOIN app.quote_costs c ON c.quote_id = q.id
                WHERE q.id = o.current_quote_id AND q.status = 'sent' AND c.maker_quote_id = OLD.id) THEN
      RAISE EXCEPTION 'the quote the branch is reviewing is based on this maker quote' USING ERRCODE = '23514';
    END IF;
    NEW.note := nullif(app.trim_text(NEW.note), '');
    IF NEW.status = 'declined' THEN
      IF NEW.note IS NULL THEN
        RAISE EXCEPTION 'a declined maker quote needs a note' USING ERRCODE = '23514';
      END IF;
      NEW.answered_at := now();
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid maker quote change % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER maker_quote_guard BEFORE INSERT OR UPDATE ON app.maker_quotes
  FOR EACH ROW EXECUTE FUNCTION app.maker_quote_guard();

-- Quotes ---------------------------------------------------------------------------

-- The only way to create a quote to A社 (and its costs). SECURITY DEFINER so it
-- can write quotes and quote_costs, which procurement_user cannot insert into;
-- row-level security does not apply inside, so it checks everything itself:
-- the caller is an agent or admin of the order's organization, the order is
-- awaiting a quote (locked first, like every answer to a quote, so quoting and
-- answering never deadlock), the maker quote is a received, unexpired reply
-- for this order, and every amount is in range. All amounts are computed here.
CREATE FUNCTION app.issue_quote(p_order uuid, p_maker_quote uuid, p_mode text, p_markup_bp integer,
                                p_prices jsonb, p_shipping_fee integer, p_expenses integer,
                                p_valid_until date, p_note text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  me uuid := app.current_user_id();
  org uuid := app.current_org_id();
  o app.orders;
  mq app.maker_quotes;
  l record;
  e jsonb;
  price numeric;
  prices jsonb := '{}';
  unit_cost bigint;
  unit_price bigint;
  amount bigint;
  sum10 bigint := 0;
  sum8 bigint := 0;
  sales_lines jsonb := '[]';
  cost_lines jsonb := '[]';
  n integer := 0;
  v_version integer;
  v_quote uuid;
  v_subtotal_10 bigint;
  v_subtotal_8 bigint;
  v_tax_10 bigint;
  v_tax_8 bigint;
BEGIN
  IF me IS NULL OR org IS NULL OR NOT app.is_agent() THEN
    RAISE EXCEPTION 'only the agent issues quotes' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM app.orders WHERE id = p_order AND org_id = org FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = '42501';
  END IF;
  IF o.status NOT IN ('sourcing', 'quoted') THEN
    RAISE EXCEPTION 'order is not awaiting a quote' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO mq FROM app.maker_quotes WHERE id = p_maker_quote AND org_id = org FOR SHARE;
  IF mq.id IS NULL OR mq.order_id <> o.id THEN
    RAISE EXCEPTION 'the maker quote is not for this request' USING ERRCODE = '23514';
  END IF;
  IF mq.status <> 'received' THEN
    RAISE EXCEPTION 'the maker quote has not been received' USING ERRCODE = '23514';
  END IF;
  IF mq.valid_until < app.today_jst() THEN
    RAISE EXCEPTION 'the maker quote has expired' USING ERRCODE = '23514';
  END IF;
  IF p_valid_until IS NULL OR p_valid_until < app.today_jst() OR p_valid_until > app.today_jst() + 180 THEN
    RAISE EXCEPTION 'quote validity must be between today and 180 days' USING ERRCODE = '23514';
  END IF;
  IF p_shipping_fee IS NULL OR p_shipping_fee NOT BETWEEN 0 AND 10000000
     OR p_expenses IS NULL OR p_expenses NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'shipping and expenses must be whole yen up to 10,000,000' USING ERRCODE = '23514';
  END IF;
  IF p_mode = 'markup' THEN
    IF p_markup_bp IS NULL OR p_markup_bp NOT BETWEEN 0 AND 30000 THEN
      RAISE EXCEPTION 'markup must be between 0 and 30000 basis points' USING ERRCODE = '23514';
    END IF;
  ELSIF p_mode = 'price' THEN
    IF jsonb_typeof(p_prices) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'prices must cover every outline line once' USING ERRCODE = '23514';
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_prices) LOOP
      IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'order_line_id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(e->'unit_price') IS DISTINCT FROM 'number' OR prices ? (e->>'order_line_id') THEN
        RAISE EXCEPTION 'prices must cover every outline line once' USING ERRCODE = '23514';
      END IF;
      price := (e->>'unit_price')::numeric;
      IF price <> trunc(price) OR price NOT BETWEEN 0 AND 100000000 THEN
        RAISE EXCEPTION 'unit prices must be whole yen up to 100,000,000' USING ERRCODE = '23514';
      END IF;
      prices := prices || jsonb_build_object(e->>'order_line_id', price::bigint);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'pricing mode must be markup or price' USING ERRCODE = '23514';
  END IF;

  FOR l IN SELECT ol.id, ol.name, ol.spec, ol.unit, ol.tax_rate, ol.qty,
                  (SELECT (x->>'unit_cost')::bigint FROM jsonb_array_elements(mq.lines) x
                    WHERE x->>'order_line_id' = ol.id::text) AS cost
             FROM app.order_lines ol WHERE ol.order_id = o.id
            ORDER BY ol.position, ol.created_at, ol.id LOOP
    n := n + 1;
    IF l.cost IS NULL THEN
      RAISE EXCEPTION 'the maker quote does not cover the outline' USING ERRCODE = '23514';
    END IF;
    unit_cost := l.cost;
    IF p_mode = 'markup' THEN
      unit_price := app.selling_price(unit_cost, p_markup_bp);
    ELSE
      IF NOT prices ? l.id::text THEN
        RAISE EXCEPTION 'prices must cover every outline line once' USING ERRCODE = '23514';
      END IF;
      unit_price := (prices->>l.id::text)::bigint;
    END IF;
    amount := unit_price * l.qty;
    IF l.tax_rate = 10 THEN sum10 := sum10 + amount; ELSE sum8 := sum8 + amount; END IF;
    sales_lines := sales_lines || jsonb_build_array(jsonb_build_object(
      'line_no', n, 'order_line_id', l.id, 'name', l.name, 'spec', l.spec, 'unit', l.unit,
      'tax_rate', l.tax_rate, 'qty', l.qty, 'unit_price', unit_price, 'amount', amount));
    cost_lines := cost_lines || jsonb_build_array(jsonb_build_object(
      'order_line_id', l.id, 'unit_cost', unit_cost, 'unit_price', unit_price, 'qty', l.qty,
      'cost_amount', unit_cost * l.qty, 'sales_amount', amount, 'profit', amount - unit_cost * l.qty));
  END LOOP;
  IF n = 0 OR (p_mode = 'price' AND (SELECT count(*) FROM jsonb_object_keys(prices)) <> n) THEN
    RAISE EXCEPTION 'prices must cover every outline line once' USING ERRCODE = '23514';
  END IF;

  -- Shipping and expenses are taxed at the standard rate.
  v_subtotal_10 := sum10 + p_shipping_fee + p_expenses;
  v_subtotal_8 := sum8;
  v_tax_10 := app.tax_amount(v_subtotal_10, 10);
  v_tax_8 := app.tax_amount(v_subtotal_8, 8);
  v_version := coalesce((SELECT max(version) FROM app.quotes WHERE order_id = o.id), 0) + 1;

  INSERT INTO app.quotes (org_id, order_id, version, status, lines, shipping_fee, expenses,
                          subtotal_10, tax_10, subtotal_8, tax_8, total, valid_until, note,
                          issued_by, issued_at)
  VALUES (org, o.id, v_version, 'sent', sales_lines, p_shipping_fee, p_expenses,
          v_subtotal_10, v_tax_10, v_subtotal_8, v_tax_8,
          v_subtotal_10 + v_tax_10 + v_subtotal_8 + v_tax_8, p_valid_until,
          nullif(app.trim_text(p_note), ''), me, now())
  RETURNING id INTO v_quote;
  INSERT INTO app.quote_costs (quote_id, org_id, maker_quote_id, pricing_mode, markup_bp, lines,
                               cost_subtotal, sales_subtotal, profit)
  VALUES (v_quote, org, mq.id, p_mode, CASE WHEN p_mode = 'markup' THEN p_markup_bp END, cost_lines,
          mq.cost_subtotal, sum10 + sum8 + p_shipping_fee + p_expenses,
          sum10 + sum8 + p_shipping_fee + p_expenses - mq.cost_subtotal);
  UPDATE app.quotes SET status = 'superseded'
   WHERE order_id = o.id AND status = 'sent' AND id <> v_quote;
  UPDATE app.orders SET status = 'quoted', current_quote_id = v_quote WHERE id = o.id;
  RETURN v_quote;
END $$;

-- A quote changes once: superseded by a newer one, or answered by the branch.
CREATE FUNCTION app.quote_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o app.orders;
BEGIN
  IF app.current_role() IS NULL THEN
    RAISE EXCEPTION 'not a member of this organization' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'sent' THEN
    RAISE EXCEPTION 'this quote was already answered or replaced' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM app.orders WHERE id = OLD.order_id;
  CASE NEW.status
    WHEN 'superseded' THEN
      IF NOT app.is_agent() OR NEW.responded_by IS NOT NULL OR NEW.response_note IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM app.quotes WHERE order_id = OLD.order_id
                         AND status = 'sent' AND version > OLD.version) THEN
        RAISE EXCEPTION 'only a newer quote replaces this one' USING ERRCODE = '42501';
      END IF;
      NEW.responded_at := NULL;
    WHEN 'accepted', 'declined' THEN
      IF app.current_role() <> 'client' OR o.store_id IS DISTINCT FROM app.current_store_id() THEN
        RAISE EXCEPTION 'only the requesting branch answers a quote' USING ERRCODE = '42501';
      END IF;
      IF o.status <> 'quoted' OR o.current_quote_id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'this is not the current quote' USING ERRCODE = '42501';
      END IF;
      IF NEW.responded_by IS DISTINCT FROM app.current_user_id() THEN
        RAISE EXCEPTION 'responded_by must be the current user' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'accepted' AND OLD.valid_until < app.today_jst() THEN
        RAISE EXCEPTION 'the quote has expired' USING ERRCODE = '23514';
      END IF;
      IF NEW.status = 'declined' AND coalesce(length(app.trim_text(NEW.response_note)), 0) = 0 THEN
        RAISE EXCEPTION 'a revision request needs a note' USING ERRCODE = '23514';
      END IF;
      NEW.responded_at := now();
    ELSE
      RAISE EXCEPTION 'invalid quote transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END CASE;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_guard BEFORE UPDATE ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_guard();

-- The branch's answer moves the order in the same statement, as the caller:
-- acceptance is the agreement, a revision request sends it back to sourcing.
CREATE FUNCTION app.quote_answered() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'accepted' THEN
    UPDATE app.orders SET status = 'agreed' WHERE id = NEW.order_id;
  ELSIF NEW.status = 'declined' THEN
    UPDATE app.orders SET status = 'sourcing', revision_note = NEW.response_note
     WHERE id = NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER quote_answered AFTER UPDATE ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_answered();

-- Notifications and audit -----------------------------------------------------------
-- Payloads for A社 (audience 'client') are built from A社-visible data only:
-- the order, its branch and the quote's selling prices. Costs appear only in
-- payloads to makers, which only B社 reads.
--
-- The four helpers below run as their caller (no SECURITY DEFINER): their only
-- caller, the definer trigger app.order_events, runs them as the owner, while a
-- direct call would see only what the caller's row-level security allows and
-- could not write to the outbox at all.

CREATE FUNCTION app.order_snapshot(p_order uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT jsonb_build_object(
    'order_id', o.id, 'request_number', o.request_number, 'title', o.title,
    'org_name', org.name, 'client_name', org.client_name, 'store_name', s.name,
    'store_code', s.code, 'requested_by', u.name, 'needed_by', o.needed_by)
  FROM app.orders o
  JOIN app.organizations org ON org.id = o.org_id
  JOIN app.stores s ON s.id = o.store_id
  JOIN app.users u ON u.id = o.created_by
  WHERE o.id = p_order
$$;

-- Selling prices only (app.quotes has no cost columns).
CREATE FUNCTION app.quote_snapshot(p_quote uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT jsonb_build_object(
    'quote_version', q.version, 'valid_until', q.valid_until, 'lines', q.lines,
    'shipping_fee', q.shipping_fee, 'expenses', q.expenses, 'subtotal_10', q.subtotal_10,
    'tax_10', q.tax_10, 'subtotal_8', q.subtotal_8, 'tax_8', q.tax_8, 'total', q.total,
    'quote_note', q.note, 'issued_by', i.name, 'issued_at', q.issued_at,
    'responded_by', r.name, 'responded_at', q.responded_at)
  FROM app.quotes q
  JOIN app.users i ON i.id = q.issued_by
  LEFT JOIN app.users r ON r.id = q.responded_by
  WHERE q.id = p_quote
$$;

-- Where the goods go: A社's branch (direct from the maker) or B社 (via B社).
CREATE FUNCTION app.delivery_destination(p_order uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT CASE o.delivery_mode
           WHEN 'direct' THEN concat_ws(' ', org.client_name, s.name, s.address)
           WHEN 'via_agent' THEN concat_ws(' ', org.name, org.address) END
  FROM app.orders o
  JOIN app.organizations org ON org.id = o.org_id
  JOIN app.stores s ON s.id = o.store_id
  WHERE o.id = p_order
$$;

-- Queue one notification per person on a side: 'client' is the staff of the
-- requesting branch, 'agent' is B社 (agents and admins).
CREATE FUNCTION app.notify(p_order app.orders, p_event text, p_audience text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.outbox (org_id, order_id, event, audience, to_user_id, to_email, payload)
  SELECT p_order.org_id, p_order.id, p_event, p_audience, u.id, u.email, p_payload
    FROM app.memberships m JOIN app.users u ON u.id = m.user_id
   WHERE m.org_id = p_order.org_id
     AND CASE p_audience
           WHEN 'client' THEN m.role = 'client' AND m.store_id = p_order.store_id
           ELSE m.role IN ('agent', 'admin') END
   ORDER BY u.email;
END $$;

CREATE FUNCTION app.order_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  payload jsonb;
  msg record;
  po jsonb;
  maker_email text;
BEGIN
  IF NEW.status = OLD.status AND NEW.current_quote_id IS NOT DISTINCT FROM OLD.current_quote_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail)
  VALUES (NEW.org_id, NEW.id, app.current_user_id(),
          CASE WHEN NEW.status = OLD.status THEN 'quote:revised' ELSE 'status:' || NEW.status END,
          jsonb_strip_nulls(jsonb_build_object(
            'from', OLD.status,
            'request_number', CASE WHEN OLD.status = 'draft' THEN NEW.request_number END,
            'po_number', CASE WHEN NEW.status = 'ordered' THEN NEW.po_number END,
            'total', CASE WHEN NEW.status = 'agreed' THEN NEW.agreed_total END,
            'delivery_mode', CASE WHEN NEW.status = 'ordered' THEN NEW.delivery_mode END,
            'delivery_date', CASE WHEN NEW.status = 'scheduled' THEN NEW.delivery_date END,
            'reason', CASE NEW.status WHEN 'rejected' THEN NEW.reject_reason
                                      WHEN 'cancelled' THEN NEW.cancel_reason END,
            'revision_note', CASE WHEN OLD.status = 'quoted' AND NEW.status = 'sourcing'
                                  THEN NEW.revision_note END)));

  payload := app.order_snapshot(NEW.id);
  CASE
    WHEN OLD.status = 'draft' AND NEW.status = 'requested' THEN
      PERFORM app.notify(NEW, 'requested', 'agent',
                         payload || jsonb_build_object('answers', NEW.answers, 'note', NEW.note));
    WHEN OLD.status = 'requested' AND NEW.status = 'hearing' THEN
      SELECT m.body, u.name INTO msg FROM app.order_messages m JOIN app.users u ON u.id = m.author_id
       WHERE m.order_id = NEW.id AND m.kind = 'question' ORDER BY m.created_at DESC LIMIT 1;
      PERFORM app.notify(NEW, 'question', 'client',
                         payload || jsonb_build_object('question', msg.body, 'asked_by', msg.name));
    WHEN OLD.status = 'hearing' AND NEW.status = 'requested' THEN
      SELECT m.body, u.name INTO msg FROM app.order_messages m JOIN app.users u ON u.id = m.author_id
       WHERE m.order_id = NEW.id AND m.kind = 'answer' ORDER BY m.created_at DESC LIMIT 1;
      PERFORM app.notify(NEW, 'answered', 'agent',
                         payload || jsonb_build_object('answer', msg.body, 'answered_by', msg.name));
    WHEN NEW.status = 'quoted' THEN
      PERFORM app.notify(NEW, 'quoted', 'client', payload || app.quote_snapshot(NEW.current_quote_id));
    WHEN OLD.status = 'quoted' AND NEW.status = 'sourcing' THEN
      PERFORM app.notify(NEW, 'revision', 'agent',
                         payload || jsonb_build_object(
                           'quote_version', (SELECT version FROM app.quotes WHERE id = NEW.current_quote_id),
                           'revision_note', NEW.revision_note));
    WHEN NEW.status = 'agreed' THEN
      PERFORM app.notify(NEW, 'agreed', 'agent', payload || app.quote_snapshot(NEW.current_quote_id));
    WHEN NEW.status = 'ordered' THEN
      -- The purchase order (発注書) to the maker of the adopted maker quote.
      -- Numbers and the outline only: A社's free-text title stays out.
      SELECT mk.email,
             jsonb_build_object(
               'po_number', NEW.po_number, 'request_number', NEW.request_number,
               'org_name', org.name, 'maker_name', mk.name,
               'lines', (SELECT jsonb_agg(jsonb_build_object(
                                  'name', ol.name, 'spec', ol.spec, 'qty', ol.qty, 'unit', ol.unit,
                                  'unit_cost', (x->>'unit_cost')::bigint,
                                  'cost_amount', (x->>'cost_amount')::bigint)
                                ORDER BY ol.position, ol.created_at, ol.id)
                           FROM jsonb_array_elements(c.lines) x
                           JOIN app.order_lines ol ON ol.id = (x->>'order_line_id')::uuid),
               'shipping_cost', mq.shipping_cost, 'cost_subtotal', c.cost_subtotal,
               'delivery_mode', NEW.delivery_mode, 'destination', app.delivery_destination(NEW.id),
               'delivery_note', NEW.delivery_note, 'needed_by', NEW.needed_by,
               'agent_name', a.name, 'agent_email', a.email)
        INTO maker_email, po
        FROM app.quote_costs c
        JOIN app.maker_quotes mq ON mq.id = c.maker_quote_id
        JOIN app.makers mk ON mk.id = mq.maker_id
        JOIN app.organizations org ON org.id = NEW.org_id
        JOIN app.users a ON a.id = NEW.assigned_to
       WHERE c.quote_id = NEW.current_quote_id;
      INSERT INTO app.outbox (org_id, order_id, event, audience, to_email, payload)
      VALUES (NEW.org_id, NEW.id, 'ordered', 'maker', maker_email, po);
    WHEN NEW.status = 'scheduled' THEN
      -- The delivery notice (納期のお知らせ) to A社: selling prices, no costs.
      PERFORM app.notify(NEW, 'scheduled', 'client', (
        SELECT jsonb_build_object(
                 'order_id', NEW.id, 'request_number', NEW.request_number, 'title', NEW.title,
                 'client_name', org.client_name, 'store_name', s.name,
                 'lines', (SELECT jsonb_agg(jsonb_build_object(
                                    'name', x->'name', 'spec', x->'spec', 'qty', x->'qty',
                                    'unit', x->'unit', 'tax_rate', x->'tax_rate',
                                    'unit_price', x->'unit_price', 'amount', x->'amount')
                                  ORDER BY (x->>'line_no')::int)
                             FROM jsonb_array_elements(q.lines) x),
                 'shipping_fee', q.shipping_fee, 'expenses', q.expenses,
                 'subtotal_10', q.subtotal_10, 'tax_10', q.tax_10,
                 'subtotal_8', q.subtotal_8, 'tax_8', q.tax_8, 'total', NEW.agreed_total,
                 'delivery_date', NEW.delivery_date, 'delivery_mode', NEW.delivery_mode,
                 'destination', app.delivery_destination(NEW.id), 'delivery_note', NEW.delivery_note,
                 'org_name', org.name, 'agent_name', a.name, 'agent_email', a.email)
          FROM app.quotes q
          JOIN app.organizations org ON org.id = NEW.org_id
          JOIN app.stores s ON s.id = NEW.store_id
          JOIN app.users a ON a.id = NEW.assigned_to
         WHERE q.id = NEW.current_quote_id));
    WHEN NEW.status = 'rejected' THEN
      PERFORM app.notify(NEW, 'rejected', 'client', payload || jsonb_build_object('reason', NEW.reject_reason));
    WHEN NEW.status = 'cancelled' THEN
      PERFORM app.notify(NEW, 'cancelled', 'agent', payload || jsonb_build_object('reason', NEW.cancel_reason));
    ELSE
      NULL; -- outline confirmed or reopened: B社's own work, no mail
  END CASE;
  RETURN NULL;
END $$;
CREATE TRIGGER order_events AFTER UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_events();

-- Asking a maker sends it the request for a quote: the request number and the
-- outline only, never A社's name, branch, address or free-text title.
CREATE FUNCTION app.maker_quote_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;
  INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail, agent_only)
  VALUES (NEW.org_id, NEW.order_id, app.current_user_id(), 'maker_quote:' || NEW.status,
          jsonb_build_object('maker_quote_id', NEW.id, 'maker_id', NEW.maker_id, 'status', NEW.status),
          true);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app.outbox (org_id, order_id, event, audience, to_email, payload)
    SELECT NEW.org_id, NEW.order_id, 'rfq', 'maker', mk.email,
           jsonb_build_object(
             'request_number', o.request_number, 'needed_by', o.needed_by,
             'org_name', org.name, 'maker_name', mk.name, 'agent_name', u.name, 'agent_email', u.email,
             'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                'name', l.name, 'spec', l.spec, 'qty', l.qty, 'unit', l.unit)
                              ORDER BY l.position, l.created_at, l.id), '[]')
                         FROM app.order_lines l WHERE l.order_id = o.id))
      FROM app.orders o
      JOIN app.organizations org ON org.id = o.org_id
      JOIN app.makers mk ON mk.id = NEW.maker_id
      JOIN app.users u ON u.id = NEW.requested_by
     WHERE o.id = NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER maker_quote_events AFTER INSERT OR UPDATE ON app.maker_quotes
  FOR EACH ROW EXECUTE FUNCTION app.maker_quote_events();

CREATE FUNCTION app.message_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  -- Never the body: notes are B社's own, and audit details stay short.
  INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail, agent_only)
  VALUES (NEW.org_id, NEW.order_id, NEW.author_id, 'message:' || NEW.kind,
          jsonb_build_object('message_id', NEW.id, 'kind', NEW.kind), NEW.kind = 'note');
  RETURN NULL;
END $$;
-- AFTER triggers run in name order: the message's entry precedes the status change.
CREATE TRIGGER message_aa_audit AFTER INSERT ON app.order_messages
  FOR EACH ROW EXECUTE FUNCTION app.message_audit();

CREATE FUNCTION app.quote_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'quote_costs' THEN
    -- How the price was set, for B社 only, without any figure.
    INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail, agent_only)
    SELECT NEW.org_id, q.order_id, app.current_user_id(), 'quote:pricing',
           jsonb_build_object('quote_id', NEW.quote_id, 'maker_quote_id', NEW.maker_quote_id,
                              'pricing_mode', NEW.pricing_mode), true
      FROM app.quotes q WHERE q.id = NEW.quote_id;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail)
    VALUES (NEW.org_id, NEW.order_id, app.current_user_id(), 'quote:issued',
            jsonb_build_object('version', NEW.version, 'total', NEW.total,
                               'valid_until', NEW.valid_until, 'lines', jsonb_array_length(NEW.lines)));
  ELSIF NEW.status IN ('accepted', 'declined') THEN
    INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail)
    VALUES (NEW.org_id, NEW.order_id, app.current_user_id(), 'quote:' || NEW.status,
            jsonb_strip_nulls(jsonb_build_object('version', NEW.version, 'total', NEW.total,
                                                 'note', NEW.response_note)));
  END IF;
  RETURN NULL;
END $$;
-- AFTER triggers run in name order: this one sorts before quote_answered, so
-- the quote's own entry precedes the order change it causes.
CREATE TRIGGER quote_aa_audit AFTER INSERT OR UPDATE ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_audit();
CREATE TRIGGER quote_costs_audit AFTER INSERT ON app.quote_costs
  FOR EACH ROW EXECUTE FUNCTION app.quote_audit();

-- Changes by B社 that are not about one request: catalog, intake form, makers.
-- Readable by admins only (order_id is null).
CREATE FUNCTION app.catalog_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'catalog_sources' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO app.audit_log (org_id, actor_id, action, detail)
      VALUES (NEW.org_id, app.current_user_id(), 'catalog:source',
              jsonb_build_object('source', NEW.name, 'kind', NEW.kind, 'urls', to_jsonb(NEW.urls)));
    ELSIF NEW.imported_at IS DISTINCT FROM OLD.imported_at THEN
      INSERT INTO app.audit_log (org_id, actor_id, action, detail)
      VALUES (NEW.org_id, app.current_user_id(), 'catalog:import',
              jsonb_build_object('source', NEW.name) || coalesce(NEW.last_import - 'errors' - 'skipped', '{}'));
    ELSIF ROW(NEW.name, NEW.urls, NEW.prices_include_tax, NEW.default_tax_rate)
          IS DISTINCT FROM ROW(OLD.name, OLD.urls, OLD.prices_include_tax, OLD.default_tax_rate) THEN
      INSERT INTO app.audit_log (org_id, actor_id, action, detail)
      VALUES (NEW.org_id, app.current_user_id(), 'catalog:source-edit',
              jsonb_build_object('source', NEW.name));
    END IF;
  ELSIF TG_TABLE_NAME = 'catalog_items' THEN
    IF NEW.active IS DISTINCT FROM OLD.active OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
       OR NEW.unit IS DISTINCT FROM OLD.unit THEN
      INSERT INTO app.audit_log (org_id, actor_id, action, detail)
      VALUES (NEW.org_id, app.current_user_id(), 'catalog:item',
              jsonb_strip_nulls(jsonb_build_object('item', NEW.name,
                'active', CASE WHEN NEW.active IS DISTINCT FROM OLD.active THEN NEW.active END,
                'tax_rate', CASE WHEN NEW.tax_rate IS DISTINCT FROM OLD.tax_rate THEN NEW.tax_rate END,
                'unit', CASE WHEN NEW.unit IS DISTINCT FROM OLD.unit THEN NEW.unit END)));
    END IF;
  ELSIF TG_TABLE_NAME = 'request_fields' THEN
    INSERT INTO app.audit_log (org_id, actor_id, action, detail)
    VALUES (NEW.org_id, app.current_user_id(),
            CASE TG_OP WHEN 'INSERT' THEN 'intake:field-added' ELSE 'intake:field-changed' END,
            jsonb_build_object('key', NEW.key, 'label', NEW.label, 'kind', NEW.kind,
                               'required', NEW.required, 'active', NEW.active));
  ELSIF TG_TABLE_NAME = 'makers' THEN
    INSERT INTO app.audit_log (org_id, actor_id, action, detail)
    VALUES (NEW.org_id, app.current_user_id(),
            CASE TG_OP WHEN 'INSERT' THEN 'maker:added' ELSE 'maker:changed' END,
            jsonb_build_object('maker_id', NEW.id, 'name', NEW.name, 'active', NEW.active));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER catalog_source_audit AFTER INSERT OR UPDATE ON app.catalog_sources
  FOR EACH ROW EXECUTE FUNCTION app.catalog_audit();
-- Imports update many rows at once; only edits by B社 are audited.
CREATE TRIGGER catalog_item_audit AFTER UPDATE OF active, tax_rate, unit ON app.catalog_items
  FOR EACH ROW EXECUTE FUNCTION app.catalog_audit();
CREATE TRIGGER request_field_audit AFTER INSERT OR UPDATE ON app.request_fields
  FOR EACH ROW EXECUTE FUNCTION app.catalog_audit();
CREATE TRIGGER maker_audit AFTER INSERT OR UPDATE ON app.makers
  FOR EACH ROW EXECUTE FUNCTION app.catalog_audit();

-- Who was notified about an order and whether it went out, for anyone who can
-- see the order (people read only their own notifications in the outbox).
-- A社 staff do not see mail to makers (that would show which makers were asked).
CREATE FUNCTION app.order_deliveries(p_order uuid)
RETURNS TABLE (event text, audience text, recipients bigint, delivered bigint, latest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT x.event, x.audience, count(*), count(*) FILTER (WHERE x.status IN ('sent', 'demo')),
         max(x.created_at)
    FROM app.outbox x JOIN app.orders o ON o.id = x.order_id
   WHERE x.order_id = p_order AND o.org_id = app.current_org_id()
     AND ((app.is_agent() AND o.status <> 'draft')
          OR (app.current_role() = 'client' AND o.store_id = app.current_store_id()
              AND x.audience <> 'maker'))
   GROUP BY x.event, x.audience
   ORDER BY max(x.created_at), x.audience
$$;

-- Authentication: only procurement_auth (used by src/server/auth.ts) may call
-- these; procurement_user, which runs every request, never sees a password
-- hash or creates a session.

CREATE FUNCTION app.auth_lookup(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT u.id, u.password_hash,
         (SELECT m.org_id FROM app.memberships m WHERE m.user_id = u.id ORDER BY m.org_id LIMIT 1)
  FROM app.users u WHERE u.email = lower(p_email)
$$;

CREATE FUNCTION app.auth_create_session(p_token_hash text, p_user uuid, p_org uuid, p_ttl interval)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.memberships WHERE user_id = p_user AND org_id = p_org) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  IF p_ttl > interval '7 days' THEN
    RAISE EXCEPTION 'session too long' USING ERRCODE = '22023';
  END IF;
  DELETE FROM app.sessions WHERE expires_at < now();
  INSERT INTO app.sessions (token_hash, user_id, org_id, expires_at)
  VALUES (p_token_hash, p_user, p_org, now() + p_ttl);
END $$;

CREATE FUNCTION app.auth_session(p_token_hash text)
RETURNS TABLE (user_id uuid, org_id uuid, role text, store_id uuid, store_name text,
               user_name text, email text, org_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.user_id, s.org_id, m.role, m.store_id, st.name, u.name, u.email, o.name
  FROM app.sessions s
  JOIN app.memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
  JOIN app.users u ON u.id = s.user_id
  JOIN app.organizations o ON o.id = s.org_id
  LEFT JOIN app.stores st ON st.id = m.store_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now()
$$;

CREATE FUNCTION app.auth_delete_session(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  DELETE FROM app.sessions WHERE token_hash = p_token_hash
$$;

-- Closed to PUBLIC: every SECURITY DEFINER function except current_role() and
-- current_store_id() (they read only the caller's own membership), and the
-- notification helpers (which run as their caller). procurement_user may call
-- issue_quote and order_deliveries, procurement_auth the auth functions.
REVOKE ALL ON FUNCTION app.auth_lookup(text), app.auth_create_session(text, uuid, uuid, interval),
  app.auth_session(text), app.auth_delete_session(text), app.order_numbering(), app.order_closed(),
  app.order_events(), app.notify(app.orders, text, text, jsonb), app.order_snapshot(uuid),
  app.quote_snapshot(uuid), app.delivery_destination(uuid), app.quote_audit(), app.catalog_audit(),
  app.maker_quote_events(), app.message_audit(), app.order_deliveries(uuid),
  app.issue_quote(uuid, uuid, text, integer, jsonb, integer, integer, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.order_deliveries(uuid),
  app.issue_quote(uuid, uuid, text, integer, jsonb, integer, integer, date, text) TO procurement_user;
GRANT USAGE ON SCHEMA app TO procurement_auth;
GRANT EXECUTE ON FUNCTION app.auth_lookup(text), app.auth_create_session(text, uuid, uuid, interval),
  app.auth_session(text), app.auth_delete_session(text) TO procurement_auth;
