import { destroySession } from '../../_lib/auth.js';
import { ApiError, json, withHandler } from '../../_lib/http.js';
import { getKV } from '../../_lib/kv.js';

const handle = withHandler(async (context) => {
  if (context.request.method !== 'POST') throw new ApiError('只支持 POST', 405);

  const header = context.request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  await destroySession(getKV(context), token);

  return json({ ok: true });
});

export function onRequest(context) {
  return handle(context);
}
