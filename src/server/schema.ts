import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDatabase, PARSERS, type Database } from './db';

export const schemaSql = () =>
  readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8');

/** In-process PostgreSQL (WASM) with the full schema, for the demo and tests. */
export async function createPgliteDatabase(): Promise<{
  db: Database;
  pg: PGlite;
}> {
  const pg = new PGlite({ parsers: PARSERS });
  await pg.exec(schemaSql());
  return { db: pgliteDatabase(pg), pg };
}
