/**
 * GET /api/health — 自检。
 *
 * 存在的理由：KV 绑定是**控制台里的手工操作**，绑错了（变量名拼错、
 * 绑到别的项目上）从外面看不出来，只会表现成"所有接口都 500"。
 * 这个接口把那个失败模式收敛成一句话，省得靠猜。
 *
 * 绑定好 KV 之后，直接打开：
 *   https://你的域名/api/health
 * 看到 {"ok":true,...} 就说明线上后端通了。
 *
 * 它不需要登录，也刻意不返回任何用户数据 —— 只报告基础设施的状态。
 */

import { KV_BINDING_NAME, getKV, listKeys } from '../_lib/kv.js';
import { json } from '../_lib/http.js';

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
          '去 EdgeOne 控制台创建 KV 命名空间并绑定到本项目，' +
          `绑定时的变量名必须填 ${KV_BINDING_NAME}，然后重新部署。`,
      },
      503,
    );
  }

  // 光是对象存在还不够 —— 真读一次才知道绑定是否可用。
  // 用一个不会有人用的前缀，拿到空数组也算成功。
  return listKeys(kv, 'health_probe_')
    .then((keys) => json({ ok: true, kv: 'bound', binding: KV_BINDING_NAME, probe: keys.length }))
    .catch((error) =>
      json(
        {
          ok: false,
          kv: 'unreadable',
          binding: KV_BINDING_NAME,
          hint: `绑定存在但读不动：${error?.message ?? error}`,
        },
        503,
      ),
    );
}
