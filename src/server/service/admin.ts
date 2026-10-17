// B社 administration: the audit log and the people of both companies.
import { asUser } from '../db';
import type { Session } from '../auth';
import type { Role } from '../../core/workflow';
import { ctx, requireAdmin, type Deps } from './common';
import type { AuditEntry } from './requests';

export async function listAudit(deps: Deps, s: Session): Promise<AuditEntry[]> {
  requireAdmin(s);
  const r = await asUser(deps.db, ctx(s), (tx) =>
    tx.query<AuditEntry>(
      `SELECT a.id::text, a.action, a.detail, u.name AS actor_name, a.at, a.order_id,
              o.request_number
         FROM app.audit_log a
         LEFT JOIN app.users u ON u.id = a.actor_id
         LEFT JOIN app.orders o ON o.id = a.order_id
        ORDER BY a.id DESC LIMIT 300`,
    ),
  );
  return r.rows;
}

type Member = { name: string; email: string; role: Role };

/** A社's branches with their staff, and B社's people. */
export async function listStores(deps: Deps, s: Session) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const org = await tx.query<{
      name: string;
      client_name: string;
      address: string | null;
    }>('SELECT name, client_name, address FROM app.organizations');
    const r = await tx.query<{
      id: string;
      code: string;
      name: string;
      address: string | null;
      members: Member[];
    }>(
      `SELECT st.id, st.code, st.name, st.address,
              coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email, 'role', m.role)
                       ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
         FROM app.stores st
         LEFT JOIN app.memberships m ON m.store_id = st.id
         LEFT JOIN app.users u ON u.id = m.user_id
        GROUP BY st.id ORDER BY st.code`,
    );
    const agents = await tx.query<Member>(
      `SELECT u.name, u.email, m.role FROM app.memberships m JOIN app.users u ON u.id = m.user_id
        WHERE m.role IN ('agent', 'admin') ORDER BY m.role DESC, u.name`,
    );
    return { org: org.rows[0], stores: r.rows, agents: agents.rows };
  });
}
