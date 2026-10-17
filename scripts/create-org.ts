// Create an organization (B社, the agency) for its client company (A社),
// with A社's branches, the people of both companies and the default intake
// form, in a live database.
//
//   npm run org:create -- org.json
//
// org.json:
//   {
//     "name": "〇〇購買サポート株式会社",
//     "client_name": "株式会社〇〇",
//     "address": "B社の受入先の住所（B社経由で届けるとき・任意）",
//     "stores": [{ "code": "S01", "name": "渋谷店", "address": "東京都渋谷区…" }],
//     "people": [
//       { "email": "admin@example.com", "name": "田中 誠", "role": "admin" },
//       { "email": "agent@example.com", "name": "山田 花子", "role": "agent" },
//       { "email": "shibuya@example.com", "name": "佐藤 美咲", "role": "client", "store": "S01" }
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
import { DEFAULT_REQUEST_FIELDS } from '../src/core/intake';

const spec = z
  .object({
    name: z.string().min(1).max(100),
    client_name: z.string().min(1).max(100),
    address: z.string().max(200).optional(),
    stores: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Za-z0-9-]{1,20}$/),
          name: z.string().min(1).max(100),
          address: z.string().max(200).optional(),
        }),
      )
      .default([]),
    people: z
      .array(
        z.object({
          email: z.string().email().toLowerCase(),
          name: z.string().min(1).max(100),
          role: z.enum(['client', 'agent', 'admin']),
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
          (p.role === 'client') === !!p.store &&
          (!p.store || s.stores.some((x) => x.code === p.store)),
      ),
    'A社 staff (client) need "store" set to one of the branch codes; B社 people (agent, admin) must not have one.',
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
    'INSERT INTO app.organizations (name, client_name, address) VALUES ($1, $2, $3) RETURNING id',
    [input.name, input.client_name, input.address ?? null],
  );
  const orgId = org.rows[0].id;
  const storeIds = new Map<string, string>();
  for (const st of input.stores) {
    const r = await client.query<{ id: string }>(
      'INSERT INTO app.stores (org_id, code, name, address) VALUES ($1, $2, $3, $4) RETURNING id',
      [orgId, st.code, st.name, st.address ?? null],
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
  for (const f of DEFAULT_REQUEST_FIELDS)
    await client.query(
      `INSERT INTO app.request_fields (org_id, key, label, kind, required, options, help, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orgId,
        f.key,
        f.label,
        f.kind,
        f.required,
        f.options,
        f.help,
        f.position,
      ],
    );
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
console.log(
  `Created ${input.name} for ${input.client_name}: ${input.stores.length} branches, ${input.people.length} people, ${DEFAULT_REQUEST_FIELDS.length} intake fields.`,
);
console.log('First passwords (shown once):');
for (const [email, password] of passwords)
  console.log(`  ${email}  ${password}`);
