import { destroySession, parseBearerToken } from '../../_lib/auth.mjs';
import { ApiError, json, withHandler } from '../../_lib/http.mjs';
import { getKV } from '../../_lib/kv.mjs';

const handle = withHandler(async (context) => {
  if (context.request.method !== 'POST') throw new ApiError('只支持 POST', 405);

  // 同样要用 parseBearerToken 过一道形状：token 会被拼进 KV 的 key，
  // 畸形 token 直接当"没有 token"处理，不要让它打到存储层。
  await destroySession(getKV(context), parseBearerToken(context));

  return json({ ok: true });
});

export function onRequest(context) {
  return handle(context);
}
