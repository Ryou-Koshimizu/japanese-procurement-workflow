// Create an organization with its stores and people in a live database.
//
//   npm run org:create -- org.json
//
// org.json:
//   {
//     "name": "株式会社〇〇",
//     "stores": [{ "code": "S01", "name": "渋谷店" }],
//     "people": [
//       { "email": "hq@example.com", "name": "山田 花子", "role": "admin" },
//       { "email": "shibuya@example.com", "name": "佐藤 美咲", "role": "store", "store": "S01" }
//     ]
//   }
//
// Each person gets a random first password, printed once; hand it over
// securely. Runs as ADMIN_DATABASE_URL (the schema owner), in one transaction.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { hashPassword } from '../src/server/auth';

const spec = z
  .object({
    name: z.string().min(1).max(100),
    stores: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Za-z0-9-]{1,20}$/),
          name: z.string().min(1).max(100),
        }),
      )
      .default([]),
    people: z
      .array(
        z.object({
          email: z.string().email().toLowerCase(),
          name: z.string().min(1).max(100),
          role: z.enum(['store', 'buyer', 'admin']),
          store: z.string().optional(),
        }),
      )
      .min(1),
  })
  .refine(
    (s) => s.people.some((p) => p.role === 'admin'),
    'At least one admin is required.',
  )
  .refine(
    (s) =>
      s.people.every(
        (p) =>
          (p.role === 'store') === !!p.store &&
          (!p.store || s.stores.some((x) => x.code === p.store)),
      ),
    'Store staff need "store" set to one of the store codes; headquarters people must not have one.',
  );

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run org:create -- org.json');
const input = spec.parse(JSON.parse(readFileSync(file, 'utf8')));
const client = new pg.Client({
  connectionString: process.env.ADMIN_DATABASE_URL,
});
await client.connect();
const passwords: [string, string][] = [];
try {
  await client.query('BEGIN');
  const org = await client.query<{ id: string }>(
    'INSERT INTO app.organizations (name) VALUES ($1) RETURNING id',
    [input.name],
  );
  const orgId = org.rows[0].id;
  const storeIds = new Map<string, string>();
  for (const st of input.stores) {
    const r = await client.query<{ id: string }>(
      'INSERT INTO app.stores (org_id, code, name) VALUES ($1, $2, $3) RETURNING id',
      [orgId, st.code, st.name],
    );
    storeIds.set(st.code, r.rows[0].id);
  }
  for (const p of input.people) {
    const password = randomBytes(12).toString('base64url');
    const u = await client.query<{ id: string }>(
      'INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [p.email, p.name, await hashPassword(password)],
    );
    await client.query(
      'INSERT INTO app.memberships (org_id, user_id, role, store_id) VALUES ($1, $2, $3, $4)',
      [orgId, u.rows[0].id, p.role, p.store ? storeIds.get(p.store) : null],
    );
    passwords.push([p.email, password]);
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
console.log(
  `Created ${input.name}: ${input.stores.length} stores, ${input.people.length} people.`,
);
console.log('First passwords (shown once):');
for (const [email, password] of passwords)
  console.log(`  ${email}  ${password}`);
