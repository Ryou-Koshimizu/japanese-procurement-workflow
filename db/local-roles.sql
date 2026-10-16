-- Local development only: the login role the app connects with.
-- It owns nothing and can only act as procurement_user, procurement_mailer or
-- procurement_auth (no superuser, no BYPASSRLS). NOINHERIT: it has no rights of its own until
-- each transaction switches role (SET LOCAL ROLE in src/server/db.ts).
CREATE ROLE procurement_app LOGIN PASSWORD 'procurement_local_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
-- PostgreSQL 16+: inheritance is a property of each grant, so say it here.
GRANT procurement_user TO procurement_app WITH INHERIT FALSE, SET TRUE;
GRANT procurement_mailer TO procurement_app WITH INHERIT FALSE, SET TRUE;
GRANT procurement_auth TO procurement_app WITH INHERIT FALSE, SET TRUE;
