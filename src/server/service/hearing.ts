// Hearing: B社 asks (the request waits for A社), A社 answers (back to B社),
// and B社 keeps its own notes, which A社 never reads.
import { asUser } from '../db';
import type { Session } from '../auth';
import type { MessageKind, Status } from '../../core/workflow';
import {
  ctx,
  expectStatus,
  id,
  lockOrder,
  requireAgent,
  requireClient,
  required,
  type Deps,
} from './common';

async function post(
  deps: Deps,
  s: Session,
  orderId: string,
  kind: MessageKind,
  body: unknown,
  allowed: Status[],
) {
  const oid = id(orderId, '依頼');
  const text = required(
    body,
    2000,
    kind === 'note' ? 'メモ' : kind === 'question' ? '質問' : '回答',
  );
  return asUser(deps.db, ctx(s), async (tx) => {
    const order = await lockOrder(tx, oid);
    expectStatus(order.status, allowed);
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.order_messages (org_id, order_id, kind, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [s.orgId, oid, kind, text],
    );
    return r.rows[0].id;
  });
}

/** B社 asks A社 a question; the request waits for A社's answer. */
export async function askQuestion(
  deps: Deps,
  s: Session,
  orderId: string,
  body: unknown,
) {
  requireAgent(s);
  return post(deps, s, orderId, 'question', body, ['requested']);
}

/** A社 answers; the request goes back to B社. */
export async function answerQuestion(
  deps: Deps,
  s: Session,
  orderId: string,
  body: unknown,
) {
  requireClient(s);
  return post(deps, s, orderId, 'answer', body, ['hearing']);
}

/** B社's own memo (e.g. what was said on the phone). Never shown to A社. */
export async function addNote(
  deps: Deps,
  s: Session,
  orderId: string,
  body: unknown,
) {
  requireAgent(s);
  return post(deps, s, orderId, 'note', body, [
    'requested',
    'hearing',
    'sourcing',
    'quoted',
    'agreed',
    'ordered',
  ]);
}
