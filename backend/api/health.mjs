/**
 * GET /api/health — 自检。
 *
 * 存在的理由：绑定、权限、schema 这些都是**手工配置**出来的，
 * 配错了从外面看不出来，只表现成"某个接口 500"。这个接口把那些失败模式
 * 收敛成一句话，省得靠猜。
 *
 * 它不只检查"KV 对象取得到"，而是真的**写一条、读回来、再删掉** ——
 * 因为"读得动但写不了"是个真实存在的故障（权限只授了 SELECT 就会这样），
 * 只做读探测会漏掉它，然后你会以为是业务逻辑出了问题。
 *
 * 不需要登录，也刻意不返回任何用户数据 —— 只报告基础设施的状态。
 */

import { KV_BINDING_NAME, getKV, listKeys } from '../_lib/kv.mjs';
import { json } from '../_lib/http.mjs';

const PROBE_KEY = 'health_probe_roundtrip';

/** 写 → 读 → 删 走一遍，任何一步失败都把原因带出来 */
async function roundTrip(kv) {
  await kv.put(PROBE_KEY, JSON.stringify({ at: Date.now() }));
  const readBack = await kv.get(PROBE_KEY);
  await kv.delete(PROBE_KEY);
  if (!readBack) throw new Error('写入成功但读不回来');
  return true;
}

export function onRequest(context) {
  let kv;
  try {
    kv = getKV(context);
  } catch {
    // 绑定压根不存在。这是部署时最容易出的错，所以把该怎么做直接写进响应里。
    return json(
      {
        ok: false,
        kv: 'missing',
        binding: KV_BINDING_NAME,
        hint:
          `KV 绑定 "${KV_BINDING_NAME}" 取不到。` +
          '去 CloudBase 控制台创建 PostgreSQL 表 kv 并确认云函数能连上，' +
          '然后重新部署。',
      },
      503,
    );
  }

  return Promise.all([listKeys(kv, 'health_probe_').then(() => 'ok'), roundTrip(kv)])
    .then(() =>
      json({
        ok: true,
        kv: 'bound',
        binding: KV_BINDING_NAME,
        read: 'ok',
        write: 'ok',
      }),
    )
    .catch((error) =>
      json(
        {
          ok: false,
          kv: 'unusable',
          binding: KV_BINDING_NAME,
          // 把底层错误原样带出来 —— 这个接口就是给运维看的，
          // 隐去原因反而让人只能靠猜。
          hint: `KV 连上了但用不了：${error?.message ?? error}`,
        },
        503,
      ),
    );
}
