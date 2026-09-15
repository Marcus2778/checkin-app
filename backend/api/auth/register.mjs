import { createSession, createUser, validateCredentials } from '../../_lib/auth.mjs';
import { ApiError, json, readJson, withHandler } from '../../_lib/http.mjs';
import { getKV } from '../../_lib/kv.mjs';

const handle = withHandler(async (context) => {
  if (context.request.method !== 'POST') throw new ApiError('只支持 POST', 405);

  const { username, password } = await readJson(context.request);
  validateCredentials(username, password);

  const kv = getKV(context);
  await createUser(kv, username, password);
  const { token, expiresAt } = await createSession(kv, username);

  return json({ username, token, expiresAt }, 201);
});

export function onRequest(context) {
  return handle(context);
}
