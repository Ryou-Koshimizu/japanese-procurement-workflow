-- Store supply ordering schema.
-- Security model: the application runs every request as the non-superuser
-- role procurement_user inside a transaction with app.user_id / app.org_id
-- set. Row-level security separates organizations and stores. Triggers
-- enforce the order workflow, compute every amount, number requests and
-- purchase orders, and write the audit log and the notification outbox, so no
-- application code path can skip them.
--
-- Workflow: a store drafts a request from the catalog -> headquarters approves
-- it by sending a quote (or rejects it) -> the store accepts the quote (or asks
-- for a revision). Acceptance of the current, unexpired quote is the second
-- signature: the same statement places the order, gives it a purchase order
-- number and queues the amount to both parties (and the supplier).

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

CREATE TABLE app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{1,20}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
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

-- store: staff of one store. buyer: headquarters purchasing.
-- admin: headquarters purchasing plus catalog management and the audit log.
CREATE TABLE app.memberships (
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  user_id uuid NOT NULL REFERENCES app.users(id),
  role text NOT NULL CHECK (role IN ('store', 'buyer', 'admin')),
  store_id uuid,
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id, store_id) REFERENCES app.stores (org_id, id),
  CHECK ((role = 'store') = (store_id IS NOT NULL))
);

CREATE TABLE app.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  expires_at timestamptz NOT NULL
);

-- Catalog ----------------------------------------------------------------------

-- A supplier whose catalog comes from its own web site (structured product
-- data on the pages) or from a CSV file it provides.
CREATE TABLE app.catalog_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('site', 'csv')),
  urls text[] NOT NULL DEFAULT '{}' CHECK (cardinality(urls) <= 20),
  prices_include_tax boolean NOT NULL DEFAULT false,
  default_tax_rate smallint NOT NULL DEFAULT 10 CHECK (default_tax_rate IN (8, 10)),
  -- Where purchase orders go once both parties agree. Optional.
  order_email text CHECK (order_email IS NULL OR (order_email = lower(order_email)
    AND order_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND length(order_email) <= 200)),
  last_import jsonb,
  imported_at timestamptz,
  created_by uuid NOT NULL REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

-- Product images copied from the supplier at import time, so pages never load
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
  -- SKU when the supplier publishes one, otherwise the product page URL.
  external_key text NOT NULL CHECK (length(external_key) BETWEEN 1 AND 500),
  sku text CHECK (length(sku) <= 100),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  brand text CHECK (length(brand) <= 100),
  category text CHECK (length(category) <= 100),
  description text CHECK (length(description) <= 1000),
  unit text NOT NULL DEFAULT '個' CHECK (length(unit) BETWEEN 1 AND 20),
  -- The price as the supplier lists it, and whether that includes tax.
  listed_price integer NOT NULL CHECK (listed_price BETWEEN 0 AND 100000000),
  price_includes_tax boolean NOT NULL,
  tax_rate smallint NOT NULL CHECK (tax_rate IN (8, 10)),
  -- Reference unit price before tax, computed by catalog_item_price().
  unit_price integer NOT NULL DEFAULT 0 CHECK (unit_price BETWEEN 0 AND 100000000),
  product_url text CHECK (product_url ~ '^https?://' AND length(product_url) <= 2000),
  image_id uuid,
  -- available: found in the latest import. active: headquarters lists it.
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

-- Orders -----------------------------------------------------------------------

CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  store_id uuid NOT NULL,
  -- One supplier per request: a purchase order goes to one supplier.
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'requested', 'quoted', 'ordered', 'rejected', 'cancelled')),
  request_number text,
  po_number text,
  created_by uuid NOT NULL REFERENCES app.users(id),
  requested_at timestamptz,
  needed_by date,
  note text CHECK (length(note) <= 1000),
  current_quote_id uuid,
  revision_note text CHECK (length(revision_note) <= 1000),
  reject_reason text CHECK (length(reject_reason) <= 1000),
  cancel_reason text CHECK (length(cancel_reason) <= 1000),
  ordered_at timestamptz,
  ordered_total bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, store_id) REFERENCES app.stores (org_id, id),
  FOREIGN KEY (org_id, source_id) REFERENCES app.catalog_sources (org_id, id),
  UNIQUE (org_id, request_number),
  UNIQUE (org_id, po_number),
  UNIQUE (org_id, id)
);
CREATE INDEX orders_org_status ON app.orders (org_id, status, updated_at DESC);
CREATE INDEX orders_store ON app.orders (org_id, store_id, updated_at DESC);
-- One open draft per person and supplier (the cart).
CREATE UNIQUE INDEX orders_one_draft ON app.orders (created_by, source_id) WHERE status = 'draft';

-- Requested lines. Name, price and tax rate are copied from the catalog
-- (order_line_snapshot) while the cart is open, so catalog changes after the
-- request is sent do not alter what was requested.
CREATE TABLE app.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  name text NOT NULL,
  sku text,
  unit text NOT NULL,
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  tax_rate smallint NOT NULL CHECK (tax_rate IN (8, 10)),
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 9999),
  product_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, order_id) REFERENCES app.orders (org_id, id),
  FOREIGN KEY (org_id, item_id) REFERENCES app.catalog_items (org_id, id),
  UNIQUE (order_id, item_id)
);

-- A quote is immutable once issued: lines are stored with the row and every
-- amount is computed by quote_issue() from the requested lines. Only the
-- response columns change, once.
CREATE TABLE app.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 50),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'superseded', 'accepted', 'declined')),
  lines jsonb NOT NULL,
  shipping_fee integer NOT NULL DEFAULT 0 CHECK (shipping_fee BETWEEN 0 AND 10000000),
  subtotal_10 bigint NOT NULL DEFAULT 0,
  tax_10 bigint NOT NULL DEFAULT 0,
  subtotal_8 bigint NOT NULL DEFAULT 0,
  tax_8 bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
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

-- Transactional outbox: written by trigger in the same transaction as the
-- change it reports, then delivered by the mailer (at least once).
CREATE TABLE app.outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('requested', 'quoted', 'revision', 'rejected', 'cancelled', 'ordered')),
  audience text NOT NULL CHECK (audience IN ('store', 'hq', 'supplier')),
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

CREATE TABLE app.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  order_id uuid,
  actor_id uuid REFERENCES app.users(id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
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

CREATE FUNCTION app.is_hq() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.current_role() IN ('buyer', 'admin'), false)
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

-- Row-level security ----------------------------------------------------------

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_read ON app.organizations FOR SELECT TO procurement_user
  USING (id = app.current_org_id() AND app.current_role() IS NOT NULL);

-- Store staff see their own store; headquarters sees every store.
CREATE POLICY stores_read ON app.stores FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id()
         AND (app.is_hq() OR id = app.current_store_id()));

-- Store staff see their colleagues and headquarters, not other stores' staff.
CREATE POLICY members_read ON app.memberships FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
         AND (app.is_hq() OR role IN ('buyer', 'admin') OR store_id = app.current_store_id()));

CREATE POLICY users_read ON app.users FOR SELECT TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.memberships m WHERE m.user_id = users.id));

CREATE POLICY sources_read ON app.catalog_sources FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL);
CREATE POLICY sources_insert ON app.catalog_sources FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin'
              AND created_by = app.current_user_id());
CREATE POLICY sources_update ON app.catalog_sources FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin')
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY images_read ON app.catalog_images FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL);
CREATE POLICY images_insert ON app.catalog_images FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin');

-- Store staff see only what headquarters lists.
CREATE POLICY items_read ON app.catalog_items FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
         AND (app.is_hq() OR active));
CREATE POLICY items_insert ON app.catalog_items FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin');
CREATE POLICY items_update ON app.catalog_items FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin')
  WITH CHECK (org_id = app.current_org_id());

-- Headquarters sees every store's requests but nobody's cart. Store staff see
-- their store's requests and their own cart.
CREATE POLICY orders_read ON app.orders FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND (
           (app.is_hq() AND status <> 'draft')
           OR (app.current_role() = 'store' AND store_id = app.current_store_id()
               AND (status <> 'draft' OR created_by = app.current_user_id()))));
CREATE POLICY orders_insert ON app.orders FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'store'
              AND store_id = app.current_store_id()
              AND created_by = app.current_user_id() AND status = 'draft');
-- A cart is thrown away by deleting it (and its lines) while still a draft.
CREATE POLICY orders_delete ON app.orders FOR DELETE TO procurement_user
  USING (org_id = app.current_org_id() AND status = 'draft'
         AND created_by = app.current_user_id());
CREATE POLICY orders_update ON app.orders FOR UPDATE TO procurement_user
  USING (org_id = app.current_org_id() AND (
           (app.is_hq() AND status <> 'draft')
           OR (app.current_role() = 'store' AND store_id = app.current_store_id()
               AND (status <> 'draft' OR created_by = app.current_user_id()))))
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY lines_read ON app.order_lines FOR SELECT TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_lines.order_id));
CREATE POLICY lines_insert ON app.order_lines FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND EXISTS (
    SELECT 1 FROM app.orders o WHERE o.id = order_lines.order_id
      AND o.status = 'draft' AND o.created_by = app.current_user_id()));
CREATE POLICY lines_update ON app.order_lines FOR UPDATE TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_lines.order_id
                   AND o.status = 'draft' AND o.created_by = app.current_user_id()))
  WITH CHECK (org_id = app.current_org_id());
CREATE POLICY lines_delete ON app.order_lines FOR DELETE TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = order_lines.order_id
                   AND o.status = 'draft' AND o.created_by = app.current_user_id()));

CREATE POLICY quotes_read ON app.quotes FOR SELECT TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = quotes.order_id));
CREATE POLICY quotes_insert ON app.quotes FOR INSERT TO procurement_user
  WITH CHECK (org_id = app.current_org_id() AND app.is_hq());
CREATE POLICY quotes_update ON app.quotes FOR UPDATE TO procurement_user
  USING (EXISTS (SELECT 1 FROM app.orders o WHERE o.id = quotes.order_id))
  WITH CHECK (org_id = app.current_org_id());

-- People read the notifications addressed to them; headquarters also reads
-- what went to suppliers.
CREATE POLICY outbox_read ON app.outbox FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
         AND (to_user_id = app.current_user_id() OR (audience = 'supplier' AND app.is_hq())));
CREATE POLICY outbox_mailer ON app.outbox FOR ALL TO procurement_mailer
  USING (true) WITH CHECK (true);

CREATE POLICY audit_read ON app.audit_log FOR SELECT TO procurement_user
  USING (org_id = app.current_org_id()
         AND (app.current_role() = 'admin'
              OR (order_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM app.orders o WHERE o.id = audit_log.order_id))));

-- procurement_user gets only what the policies above need. No DELETE except
-- carts, and nothing at all on sessions, counters or password hashes.
GRANT USAGE ON SCHEMA app TO procurement_user, procurement_mailer;
GRANT SELECT (id, email, name, created_at) ON app.users TO procurement_user;
GRANT SELECT ON app.organizations, app.stores, app.memberships, app.catalog_sources,
  app.catalog_images, app.catalog_items, app.orders, app.order_lines, app.quotes,
  app.outbox, app.audit_log TO procurement_user;
GRANT INSERT ON app.catalog_sources, app.catalog_images, app.catalog_items, app.orders,
  app.order_lines, app.quotes TO procurement_user;
GRANT UPDATE (name, urls, prices_include_tax, default_tax_rate, order_email, last_import,
  imported_at) ON app.catalog_sources TO procurement_user;
GRANT UPDATE (sku, name, brand, category, description, unit, listed_price, price_includes_tax,
  tax_rate, product_url, image_id, available, active, seen_at) ON app.catalog_items TO procurement_user;
GRANT UPDATE (status, needed_by, note, current_quote_id, revision_note, reject_reason,
  cancel_reason) ON app.orders TO procurement_user;
GRANT UPDATE (qty) ON app.order_lines TO procurement_user;
GRANT DELETE ON app.order_lines, app.orders TO procurement_user;
GRANT UPDATE (status, responded_by, responded_at, response_note) ON app.quotes TO procurement_user;
GRANT SELECT, UPDATE (status, attempts, last_error, next_attempt_at, sent_at) ON app.outbox
  TO procurement_mailer;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_org_id(), app.current_role(),
  app.current_store_id(), app.is_hq(), app.today_jst(), app.tax_amount(bigint, integer),
  app.price_before_tax(integer, boolean, integer) TO procurement_user;

-- Catalog triggers ---------------------------------------------------------------

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

-- Order lines: copy the catalog's name, price and tax rate (never the client's).
CREATE FUNCTION app.order_line_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o app.orders;
  i app.catalog_items;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.order_id <> OLD.order_id OR NEW.item_id <> OLD.item_id) THEN
    RAISE EXCEPTION 'immutable line columns' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM app.orders WHERE id = NEW.order_id;
  SELECT * INTO i FROM app.catalog_items WHERE id = NEW.item_id;
  IF TG_OP = 'UPDATE' THEN
    -- Lines change only in a draft (policy lines_update). Keep the reference
    -- price current while the cart is open; a delisted item keeps its copy.
    IF i.id IS NOT NULL THEN
      NEW.name := i.name;
      NEW.sku := i.sku;
      NEW.unit := i.unit;
      NEW.unit_price := i.unit_price;
      NEW.tax_rate := i.tax_rate;
      NEW.product_url := i.product_url;
    ELSE
      NEW.name := OLD.name;
      NEW.sku := OLD.sku;
      NEW.unit := OLD.unit;
      NEW.unit_price := OLD.unit_price;
      NEW.tax_rate := OLD.tax_rate;
      NEW.product_url := OLD.product_url;
    END IF;
    RETURN NEW;
  END IF;
  IF o.id IS NULL OR i.id IS NULL OR o.status <> 'draft' THEN
    RAISE EXCEPTION 'order or item not available' USING ERRCODE = '42501';
  END IF;
  IF i.source_id <> o.source_id THEN
    RAISE EXCEPTION 'item from another supplier' USING ERRCODE = '23514';
  END IF;
  IF NOT i.active OR NOT i.available THEN
    RAISE EXCEPTION 'item is not orderable' USING ERRCODE = '23514';
  END IF;
  NEW.org_id := o.org_id;
  NEW.name := i.name;
  NEW.sku := i.sku;
  NEW.unit := i.unit;
  NEW.unit_price := i.unit_price;
  NEW.tax_rate := i.tax_rate;
  NEW.product_url := i.product_url;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER order_line_snapshot BEFORE INSERT OR UPDATE ON app.order_lines
  FOR EACH ROW EXECUTE FUNCTION app.order_line_snapshot();

-- Order workflow ------------------------------------------------------------------

-- Whether a draft holds an item that headquarters stopped listing or the
-- supplier no longer offers. SECURITY DEFINER because store staff cannot see
-- delisted items at all, so a check under their row-level security would
-- silently skip them.
CREATE FUNCTION app.order_has_unorderable_lines(p_order uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.order_lines l
      JOIN app.orders o ON o.id = l.order_id
      LEFT JOIN app.catalog_items i ON i.id = l.item_id
     WHERE l.order_id = p_order AND o.org_id = app.current_org_id()
       AND NOT coalesce(i.active AND i.available, false))
$$;
REVOKE ALL ON FUNCTION app.order_has_unorderable_lines(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.order_has_unorderable_lines(uuid) TO procurement_user;

-- Who may move an order from one status to another. Runs as the caller, so the
-- row-level security above applies to every lookup it makes.
CREATE FUNCTION app.order_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r text := app.current_role();
  me uuid := app.current_user_id();
  own_store boolean := coalesce(app.current_role() = 'store' AND OLD.store_id = app.current_store_id(), false);
  q app.quotes;
BEGIN
  IF r IS NULL THEN
    RAISE EXCEPTION 'not a member of this organization' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id <> OLD.org_id OR NEW.store_id <> OLD.store_id OR NEW.source_id <> OLD.source_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR NEW.request_number IS DISTINCT FROM OLD.request_number
     OR NEW.po_number IS DISTINCT FROM OLD.po_number
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.ordered_at IS DISTINCT FROM OLD.ordered_at
     OR NEW.ordered_total IS DISTINCT FROM OLD.ordered_total THEN
    RAISE EXCEPTION 'immutable order columns' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('ordered', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'order is closed' USING ERRCODE = '42501';
  END IF;
  -- Each note changes only in the transition that owns it.
  IF (NEW.needed_by IS DISTINCT FROM OLD.needed_by OR NEW.note IS DISTINCT FROM OLD.note)
     AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'request details are locked once sent' USING ERRCODE = '42501';
  END IF;
  IF (NEW.revision_note IS DISTINCT FROM OLD.revision_note
      AND NOT (OLD.status = 'quoted' AND NEW.status = 'requested'))
     OR (NEW.reject_reason IS DISTINCT FROM OLD.reject_reason AND NEW.status <> 'rejected')
     OR (NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason AND NEW.status <> 'cancelled')
     OR (NEW.current_quote_id IS DISTINCT FROM OLD.current_quote_id AND NEW.status <> 'quoted') THEN
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
      IF NOT EXISTS (SELECT 1 FROM app.order_lines WHERE order_id = NEW.id) THEN
        RAISE EXCEPTION 'a request needs at least one line' USING ERRCODE = '23514';
      END IF;
      IF app.order_has_unorderable_lines(NEW.id) THEN
        RAISE EXCEPTION 'a line is no longer in the catalog' USING ERRCODE = '23514';
      END IF;
      IF NEW.needed_by IS NOT NULL AND NEW.needed_by < app.today_jst() THEN
        RAISE EXCEPTION 'the needed-by date is in the past' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status IN ('requested', 'quoted') AND NEW.status = 'quoted' THEN
      IF NOT app.is_hq() THEN
        RAISE EXCEPTION 'only headquarters quotes' USING ERRCODE = '42501';
      END IF;
      SELECT * INTO q FROM app.quotes WHERE id = NEW.current_quote_id;
      IF q.id IS NULL OR q.order_id <> NEW.id OR q.status <> 'sent'
         OR q.version <> (SELECT max(version) FROM app.quotes WHERE order_id = NEW.id) THEN
        RAISE EXCEPTION 'the current quote must be the latest one sent' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM app.quotes WHERE order_id = NEW.id AND status = 'sent' AND id <> q.id) THEN
        RAISE EXCEPTION 'an earlier quote is still open' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'requested' AND NEW.status = 'rejected' THEN
      IF NOT app.is_hq() THEN
        RAISE EXCEPTION 'only headquarters rejects' USING ERRCODE = '42501';
      END IF;
      IF coalesce(length(trim(NEW.reject_reason)), 0) = 0 THEN
        RAISE EXCEPTION 'a rejection needs a reason' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status = 'quoted' AND NEW.status = 'requested' THEN
      SELECT * INTO q FROM app.quotes WHERE id = OLD.current_quote_id;
      IF NOT own_store OR q.status IS DISTINCT FROM 'declined' OR q.responded_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'only the store asks for a revision of its quote' USING ERRCODE = '42501';
      END IF;
      IF coalesce(length(trim(NEW.revision_note)), 0) = 0 THEN
        RAISE EXCEPTION 'a revision request needs a note' USING ERRCODE = '23514';
      END IF;
    WHEN OLD.status = 'quoted' AND NEW.status = 'ordered' THEN
      -- The second signature: the store accepted the current quote.
      SELECT * INTO q FROM app.quotes WHERE id = OLD.current_quote_id;
      IF NOT own_store OR q.status IS DISTINCT FROM 'accepted' OR q.responded_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'an order needs the store to accept the current quote' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status IN ('requested', 'quoted') AND NEW.status = 'cancelled' THEN
      IF NOT own_store THEN
        RAISE EXCEPTION 'only the store withdraws its request' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END CASE;
  RETURN NEW;
END $$;

-- Numbers, timestamps and the ordered amount are set here, never by the caller
-- (procurement_user cannot even name those columns in an UPDATE).
CREATE FUNCTION app.order_numbering() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_year integer := extract(year FROM now() AT TIME ZONE 'Asia/Tokyo')::integer;
  v_kind text;
  n integer;
BEGIN
  NEW.updated_at := now();
  IF OLD.status = 'draft' AND NEW.status = 'requested' THEN
    v_kind := 'request';
  ELSIF OLD.status = 'quoted' AND NEW.status = 'ordered' THEN
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
    NEW.ordered_total := (SELECT total FROM app.quotes WHERE id = NEW.current_quote_id);
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
  IF NEW.request_number IS NOT NULL OR NEW.po_number IS NOT NULL OR NEW.current_quote_id IS NOT NULL
     OR NEW.requested_at IS NOT NULL OR NEW.ordered_at IS NOT NULL OR NEW.ordered_total IS NOT NULL
     OR NEW.revision_note IS NOT NULL OR NEW.reject_reason IS NOT NULL OR NEW.cancel_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a new order starts as an empty draft' USING ERRCODE = '42501';
  END IF;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER order_insert BEFORE INSERT ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_insert();

-- Quotes ---------------------------------------------------------------------------

-- Issue a quote: headquarters names the requested lines it will supply with a
-- unit price and quantity each. Everything else (names, tax rates, amounts,
-- totals, version) comes from the database.
CREATE FUNCTION app.quote_issue() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o app.orders;
  l app.order_lines;
  e jsonb;
  idx bigint;
  seen uuid[] := '{}';
  price numeric;
  qty numeric;
  amount bigint;
  sum10 bigint := 0;
  sum8 bigint := 0;
  out jsonb := '[]';
BEGIN
  IF NOT app.is_hq() THEN
    RAISE EXCEPTION 'only headquarters quotes' USING ERRCODE = '42501';
  END IF;
  -- Serializes quoting with acceptance and with other quotes for this order.
  SELECT * INTO o FROM app.orders WHERE id = NEW.order_id FOR UPDATE;
  IF o.id IS NULL OR o.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = '42501';
  END IF;
  IF o.status NOT IN ('requested', 'quoted') THEN
    RAISE EXCEPTION 'order is not awaiting a quote' USING ERRCODE = '42501';
  END IF;
  IF NEW.valid_until < app.today_jst() OR NEW.valid_until > app.today_jst() + 180 THEN
    RAISE EXCEPTION 'quote validity must be between today and 180 days' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a quote needs 1 to 200 lines' USING ERRCODE = '23514';
  END IF;
  FOR e, idx IN SELECT value, ordinality FROM jsonb_array_elements(NEW.lines) WITH ORDINALITY LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object'
       OR coalesce(e->>'order_line_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(e->'unit_price') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e->'qty') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'malformed quote line %', idx USING ERRCODE = '23514';
    END IF;
    price := (e->>'unit_price')::numeric;
    qty := (e->>'qty')::numeric;
    IF price <> trunc(price) OR price NOT BETWEEN 0 AND 100000000
       OR qty <> trunc(qty) OR qty NOT BETWEEN 1 AND 9999 THEN
      RAISE EXCEPTION 'quote line % needs a whole unit price and quantity', idx USING ERRCODE = '23514';
    END IF;
    SELECT * INTO l FROM app.order_lines
     WHERE id = (e->>'order_line_id')::uuid AND order_id = o.id;
    IF l.id IS NULL OR l.id = ANY (seen) THEN
      RAISE EXCEPTION 'quote line % does not match the request', idx USING ERRCODE = '23514';
    END IF;
    seen := seen || l.id;
    amount := price::bigint * qty::bigint;
    IF l.tax_rate = 10 THEN sum10 := sum10 + amount; ELSE sum8 := sum8 + amount; END IF;
    out := out || jsonb_build_object(
      'line_no', idx, 'order_line_id', l.id, 'name', l.name, 'sku', l.sku, 'unit', l.unit,
      'tax_rate', l.tax_rate, 'unit_price', price::bigint, 'qty', qty::bigint, 'amount', amount,
      'requested_qty', l.qty, 'reference_price', l.unit_price);
  END LOOP;

  NEW.version := coalesce((SELECT max(version) FROM app.quotes WHERE order_id = o.id), 0) + 1;
  NEW.status := 'sent';
  NEW.lines := out;
  -- Shipping is taxed at the standard rate.
  NEW.subtotal_10 := sum10 + NEW.shipping_fee;
  NEW.tax_10 := app.tax_amount(NEW.subtotal_10, 10);
  NEW.subtotal_8 := sum8;
  NEW.tax_8 := app.tax_amount(NEW.subtotal_8, 8);
  NEW.total := NEW.subtotal_10 + NEW.tax_10 + NEW.subtotal_8 + NEW.tax_8;
  NEW.issued_by := app.current_user_id();
  NEW.issued_at := now();
  NEW.responded_by := NULL;
  NEW.responded_at := NULL;
  NEW.response_note := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_issue BEFORE INSERT ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_issue();

-- After a quote is issued: close the previous open quote and point the order at
-- the new one (the order guard checks both).
CREATE FUNCTION app.quote_issued() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.quotes SET status = 'superseded'
   WHERE order_id = NEW.order_id AND status = 'sent' AND id <> NEW.id;
  UPDATE app.orders SET status = 'quoted', current_quote_id = NEW.id WHERE id = NEW.order_id;
  RETURN NULL;
END $$;
CREATE TRIGGER quote_issued AFTER INSERT ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_issued();

-- A quote changes once: superseded by a newer one, or answered by the store.
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
      IF NOT app.is_hq() OR NEW.responded_by IS NOT NULL OR NEW.response_note IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM app.quotes WHERE order_id = OLD.order_id
                         AND status = 'sent' AND version > OLD.version) THEN
        RAISE EXCEPTION 'only a newer quote replaces this one' USING ERRCODE = '42501';
      END IF;
      NEW.responded_at := NULL;
    WHEN 'accepted', 'declined' THEN
      IF app.current_role() <> 'store' OR o.store_id IS DISTINCT FROM app.current_store_id() THEN
        RAISE EXCEPTION 'only the requesting store answers a quote' USING ERRCODE = '42501';
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
      IF NEW.status = 'declined' AND coalesce(length(trim(NEW.response_note)), 0) = 0 THEN
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

-- The store's answer moves the order in the same statement: acceptance places
-- it, a revision request sends it back to headquarters.
CREATE FUNCTION app.quote_answered() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'accepted' THEN
    UPDATE app.orders SET status = 'ordered' WHERE id = NEW.order_id;
  ELSIF NEW.status = 'declined' THEN
    UPDATE app.orders SET status = 'requested', revision_note = NEW.response_note
     WHERE id = NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER quote_answered AFTER UPDATE ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_answered();

-- Notifications and audit -----------------------------------------------------------

CREATE FUNCTION app.order_snapshot(p_order uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT jsonb_build_object(
    'order_id', o.id, 'request_number', o.request_number, 'po_number', o.po_number,
    'org_name', org.name, 'store_name', s.name, 'store_code', s.code, 'supplier_name', c.name, 'requested_by', u.name,
    'needed_by', o.needed_by, 'note', o.note)
  FROM app.orders o
  JOIN app.organizations org ON org.id = o.org_id
  JOIN app.stores s ON s.id = o.store_id
  JOIN app.catalog_sources c ON c.id = o.source_id
  JOIN app.users u ON u.id = o.created_by
  WHERE o.id = p_order
$$;

CREATE FUNCTION app.quote_snapshot(p_quote uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT jsonb_build_object(
    'quote_version', q.version, 'valid_until', q.valid_until, 'lines', q.lines,
    'shipping_fee', q.shipping_fee, 'subtotal_10', q.subtotal_10, 'tax_10', q.tax_10,
    'subtotal_8', q.subtotal_8, 'tax_8', q.tax_8, 'total', q.total, 'quote_note', q.note,
    'issued_by', i.name, 'issued_at', q.issued_at,
    'responded_by', r.name, 'responded_at', q.responded_at)
  FROM app.quotes q
  JOIN app.users i ON i.id = q.issued_by
  LEFT JOIN app.users r ON r.id = q.responded_by
  WHERE q.id = p_quote
$$;

-- Queue one notification per person on a side: 'store' is the staff of the
-- requesting store, 'hq' is headquarters purchasing.
CREATE FUNCTION app.notify(p_order app.orders, p_event text, p_audience text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.outbox (org_id, order_id, event, audience, to_user_id, to_email, payload)
  SELECT p_order.org_id, p_order.id, p_event, p_audience, u.id, u.email, p_payload
    FROM app.memberships m JOIN app.users u ON u.id = m.user_id
   WHERE m.org_id = p_order.org_id
     AND CASE p_audience
           WHEN 'store' THEN m.role = 'store' AND m.store_id = p_order.store_id
           ELSE m.role IN ('buyer', 'admin') END
   ORDER BY u.email;
END $$;

CREATE FUNCTION app.order_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  payload jsonb;
  supplier_email text;
BEGIN
  IF NEW.status = OLD.status AND NEW.current_quote_id IS NOT DISTINCT FROM OLD.current_quote_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO app.audit_log (org_id, order_id, actor_id, action, detail)
  VALUES (NEW.org_id, NEW.id, app.current_user_id(),
          CASE WHEN NEW.status = OLD.status THEN 'quote:revised' ELSE 'status:' || NEW.status END,
          jsonb_strip_nulls(jsonb_build_object(
            'from', OLD.status,
            'request_number', CASE WHEN NEW.status = 'requested' AND OLD.status = 'draft' THEN NEW.request_number END,
            'po_number', NEW.po_number,
            'total', NEW.ordered_total,
            'reason', CASE NEW.status WHEN 'rejected' THEN NEW.reject_reason
                                      WHEN 'cancelled' THEN NEW.cancel_reason END,
            'revision_note', CASE WHEN NEW.status = 'requested' AND OLD.status = 'quoted' THEN NEW.revision_note END)));

  payload := app.order_snapshot(NEW.id) || jsonb_build_object('event_at', now());
  IF NEW.current_quote_id IS NOT NULL THEN
    payload := payload || app.quote_snapshot(NEW.current_quote_id);
  END IF;

  CASE
    WHEN OLD.status = 'draft' AND NEW.status = 'requested' THEN
      payload := payload || jsonb_build_object('lines', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'sku', sku, 'unit', unit,
                 'qty', qty, 'unit_price', unit_price, 'tax_rate', tax_rate) ORDER BY created_at, id), '[]')
          FROM app.order_lines WHERE order_id = NEW.id));
      PERFORM app.notify(NEW, 'requested', 'hq', payload);
    WHEN NEW.status = 'quoted' THEN
      PERFORM app.notify(NEW, 'quoted', 'store', payload);
    WHEN OLD.status = 'quoted' AND NEW.status = 'requested' THEN
      PERFORM app.notify(NEW, 'revision', 'hq', payload || jsonb_build_object('revision_note', NEW.revision_note));
    WHEN NEW.status = 'rejected' THEN
      PERFORM app.notify(NEW, 'rejected', 'store', payload || jsonb_build_object('reason', NEW.reject_reason));
    WHEN NEW.status = 'cancelled' THEN
      PERFORM app.notify(NEW, 'cancelled', 'hq', payload || jsonb_build_object('reason', NEW.cancel_reason));
    WHEN NEW.status = 'ordered' THEN
      -- The agreed amount goes to both parties, and the purchase order to the supplier.
      PERFORM app.notify(NEW, 'ordered', 'store', payload);
      PERFORM app.notify(NEW, 'ordered', 'hq', payload);
      SELECT order_email INTO supplier_email FROM app.catalog_sources WHERE id = NEW.source_id;
      IF supplier_email IS NOT NULL THEN
        INSERT INTO app.outbox (org_id, order_id, event, audience, to_email, payload)
        VALUES (NEW.org_id, NEW.id, 'ordered', 'supplier', supplier_email, payload);
      END IF;
    ELSE
      NULL;
  END CASE;
  RETURN NULL;
END $$;
CREATE TRIGGER order_events AFTER UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.order_events();

CREATE FUNCTION app.quote_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
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
-- AFTER triggers run in name order: this one sorts before quote_answered and
-- quote_issued, so the quote's own entry precedes the order change it causes.
CREATE TRIGGER quote_aa_audit AFTER INSERT OR UPDATE ON app.quotes
  FOR EACH ROW EXECUTE FUNCTION app.quote_audit();

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
    ELSIF ROW(NEW.name, NEW.urls, NEW.prices_include_tax, NEW.default_tax_rate, NEW.order_email)
          IS DISTINCT FROM ROW(OLD.name, OLD.urls, OLD.prices_include_tax, OLD.default_tax_rate, OLD.order_email) THEN
      INSERT INTO app.audit_log (org_id, actor_id, action, detail)
      VALUES (NEW.org_id, app.current_user_id(), 'catalog:source-edit',
              jsonb_build_object('source', NEW.name, 'order_email', NEW.order_email));
    END IF;
  ELSIF NEW.active IS DISTINCT FROM OLD.active OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
        OR NEW.unit IS DISTINCT FROM OLD.unit THEN
    INSERT INTO app.audit_log (org_id, actor_id, action, detail)
    VALUES (NEW.org_id, app.current_user_id(), 'catalog:item',
            jsonb_strip_nulls(jsonb_build_object('item', NEW.name,
              'active', CASE WHEN NEW.active IS DISTINCT FROM OLD.active THEN NEW.active END,
              'tax_rate', CASE WHEN NEW.tax_rate IS DISTINCT FROM OLD.tax_rate THEN NEW.tax_rate END,
              'unit', CASE WHEN NEW.unit IS DISTINCT FROM OLD.unit THEN NEW.unit END)));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER catalog_source_audit AFTER INSERT OR UPDATE ON app.catalog_sources
  FOR EACH ROW EXECUTE FUNCTION app.catalog_audit();
-- Imports update many rows at once; only edits by headquarters are audited.
CREATE TRIGGER catalog_item_audit AFTER UPDATE OF active, tax_rate, unit ON app.catalog_items
  FOR EACH ROW EXECUTE FUNCTION app.catalog_audit();

-- Who was notified about an order and whether it went out, for anyone who can
-- see the order (people read only their own notifications in the outbox).
CREATE FUNCTION app.order_deliveries(p_order uuid)
RETURNS TABLE (event text, audience text, recipients bigint, delivered bigint, latest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT x.event, x.audience, count(*), count(*) FILTER (WHERE x.status IN ('sent', 'demo')),
         max(x.created_at)
    FROM app.outbox x JOIN app.orders o ON o.id = x.order_id
   WHERE x.order_id = p_order AND o.org_id = app.current_org_id()
     AND ((app.is_hq() AND o.status <> 'draft')
          OR (app.current_role() = 'store' AND o.store_id = app.current_store_id()))
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

REVOKE ALL ON FUNCTION app.auth_lookup(text), app.auth_create_session(text, uuid, uuid, interval),
  app.auth_session(text), app.auth_delete_session(text), app.order_numbering(),
  app.order_events(), app.notify(app.orders, text, text, jsonb), app.order_snapshot(uuid),
  app.quote_snapshot(uuid), app.quote_audit(), app.catalog_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.order_deliveries(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.order_deliveries(uuid) TO procurement_user;
GRANT USAGE ON SCHEMA app TO procurement_auth;
GRANT EXECUTE ON FUNCTION app.auth_lookup(text), app.auth_create_session(text, uuid, uuid, interval),
  app.auth_session(text), app.auth_delete_session(text) TO procurement_auth;
