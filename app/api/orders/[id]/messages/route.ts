import { route, readJson } from '../../../../../src/server/http';
import { runtime } from '../../../../../src/server/runtime';
import {
  addNote,
  answerQuestion,
  askQuestion,
} from '../../../../../src/server/service';
import { AppError } from '../../../../../src/server/db';
import { deliverAfterResponse } from '../../../../../src/server/after';

const post = { question: askQuestion, answer: answerQuestion, note: addNote };

type Ctx = { params: Promise<{ id: string }> };
export const POST = route(async (s, request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(request, 50_000);
  const kind = body.kind as keyof typeof post;
  if (!Object.hasOwn(post, kind))
    throw new AppError(400, 'メッセージの種類が正しくありません。');
  const { deps } = await runtime();
  const result = await post[kind](deps, s, id, body.body);
  deliverAfterResponse();
  return Response.json({ ok: true, result });
});
