/**
 * KV 存储访问层。
 *
 * 这里封装了两件容易踩坑的事：
 *
 * 1. **本地开发和生产环境的 KV 访问方式不同。**
 *    生产环境走 `context.env.CHECKIN_KV`（和 Cloudflare 的绑定方式一样）；
 *    但 `edgeone makers dev` 的本地 KV 代理是把客户端挂到 `globalThis` 上的
 *    （见 CLI 源码里的 initKVBindings: `globalThis[e.name] = client`）。
 *    所以要两边都查一遍，否则会出现"本地能跑、上线就崩"。
 *
 * 2. **key 的字符集限制。** EdgeOne KV 的 key 只允许字母、数字、下划线
 *    （CLI 里硬编码了 /^[a-zA-Z0-9_]+$/），不能有冒号或短横线。
 *    所以 key 一律用下划线拼接，日期用 YYYYMMDD。
 */

/** 绑定时必须用这个名字，改这里等于换一个绑定 */
export const KV_BINDING_NAME = 'CHECKIN_KV';

/** EdgeOne KV 允许的 key 字符集 */
export const KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 用户名直接进 KV key，所以必须比 key 的规则更严一点 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export function getKV(context) {
  // 注意用 globalThis.XXX 而不是裸的 XXX：未定义时前者返回 undefined，
  // 后者会抛 ReferenceError。
  const kv = globalThis[KV_BINDING_NAME] ?? context?.env?.[KV_BINDING_NAME];
  if (!kv) {
    throw new Error(
      `KV 绑定 "${KV_BINDING_NAME}" 不可用。` +
        '本地开发需要先在控制台创建 KV 命名空间并绑定到项目，然后执行 `edgeone makers link`。',
    );
  }
  return kv;
}

/** 按前缀取出所有 key（自动翻页，不要假设一次就能拿全） */
export async function listKeys(kv, prefix) {
  const keys = [];
  let cursor;
  // 上限只是防止 cursor 实现异常时无限循环，正常几百个 key 一次就拿完了。
  for (let page = 0; page < 100; page += 1) {
    const result = await kv.list({ prefix, limit: 500, cursor });
    for (const entry of result?.keys ?? []) {
      const name = typeof entry === 'string' ? entry : (entry.key ?? entry.name);
      if (name) keys.push(name);
    }
    // 本地客户端返回 { keys, cursor, complete }；这里兼容几种可能的命名。
    const complete = result?.complete ?? result?.list_complete ?? !result?.cursor;
    cursor = result?.cursor;
    if (complete || !cursor) break;
  }
  return keys;
}

export async function getJson(kv, key) {
  const raw = await kv.get(key);
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function putJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

/* ---------- key 命名 ---------- */

export const userKey = (username) => `user_${username}`;
export const sessionKey = (token) => `session_${token}`;
export const tasksKey = (username) => `tasks_${username}`;
export const progressKey = (username, dateKey) => `prog_${username}_${dateKey}`;
export const recordKey = (username, dateKey) => `rec_${username}_${dateKey}`;

/** 从 `rec_<username>_<YYYYMMDD>` 里把日期部分取出来 */
export function dateKeyFromRecordKey(key, username) {
  const prefix = `rec_${username}_`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}
