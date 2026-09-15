import { createSession, validateCredentials, verifyCredentials } from '../../_lib/auth.js';
import { ApiError, json, readJson, withHandler } from '../../_lib/http.js';
import { getKV } from '../../_lib/kv.js';

const handle = withHandler(async (context) => {
  if (context.request.method !== 'POST') throw new ApiError('只支持 POST', 405);

  const { username, password } = await readJson(context.request);
  validateCredentials(username, password);

  const kv = getKV(context);
  await verifyCredentials(kv, username, password);
  const { token, expiresAt } = await createSession(kv, username);

  return json({ username, token, expiresAt });
});

export function onRequest(context) {
  return handle(context);
}
