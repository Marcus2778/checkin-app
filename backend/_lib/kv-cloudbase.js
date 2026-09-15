/**
 * 用 CloudBase 的 PostgreSQL 实现 `kv.js` 约定的那份 KV 契约。
 *
 * 为什么是「在关系库上做一层 KV」而不是重写成正经的表结构：
 * `store.js` / `auth.js` 和 74 个测试全都建立在 `kv.get/put/delete/list`
 * 这个契约上（契约的定义见 `memory-kv.js`）。复刻契约意味着这些**全都不用改**，
 * 迁移风险最低，而且立刻能用测试验证。代价是没吃到关系库的查询能力 ——
 * 但对这个规模完全够用，`kv.js` 就是那道随时可以撬开的缝。
 *
 * 表结构就一列 key 一列 value：
 *
 *   CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 *
 * `key` 是主键，所以按 key 查、按 key 排序、按前缀范围扫都是走索引的 ——
 * `list()` 的前缀查询因此不慢。
 *
 * 走的是 `app.rdb()`（PostgREST 客户端），属于**平台托管访问**，云函数里
 * 由平台自动注入临时凭据，不需要自己配 VPC 或连接串。这一点很关键：
 * 如果改用 `pg` 直连 TCP，就得给云函数绑 VPC（要真实的 VPC ID 和子网 ID）。
 */

import cloudbase from '@cloudbase/node-sdk';

const TABLE = 'kv';

/** 和 memory-kv.js 保持一致的不变量。数据库是最后一道防线，非法 key 不该进得来。 */
const KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

function assertKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error(`非法的 KV key（只允许字母、数字、下划线）: ${key}`);
  }
}

/** SDK 返回 { data, error } 而不是抛异常，这里统一转成抛异常 */
function unwrap({ data, error }, what) {
  if (error) {
    throw new Error(`KV 操作失败（${what}）: ${error.message ?? JSON.stringify(error)}`);
  }
  return data;
}

/**
 * @param {object} [options]
 * @param {string} [options.env] 环境 ID。云函数里默认用 SYMBOL_CURRENT_ENV 自动识别当前环境。
 */
export function createCloudbaseKV({ env = cloudbase.SYMBOL_CURRENT_ENV } = {}) {
  const db = cloudbase.init({ env }).rdb();

  return {
    async get(key) {
      assertKey(key);
      // 用 eq + 取第一条，而不是 maybeSingle()：后者在多行时直接报错，
      // 而 key 是主键，本来就只可能有一行。
      const rows = unwrap(
        await db.from(TABLE).select('value').eq('key', key).limit(1),
        `get ${key}`,
      );
      return rows?.[0]?.value ?? null;
    },

    async put(key, value) {
      assertKey(key);
      if (typeof value !== 'string') {
        throw new Error('KV 只接受字符串 value（对象请先 JSON.stringify）');
      }
      // upsert = INSERT ... ON CONFLICT (key) DO UPDATE，正好对应 KV 的语义
      unwrap(await db.from(TABLE).upsert({ key, value }), `put ${key}`);
    },

    async delete(key) {
      assertKey(key);
      // 删不存在的 key 不报错 —— 和 memory-kv.js 的行为一致
      unwrap(await db.from(TABLE).delete().eq('key', key), `delete ${key}`);
    },

    /**
     * 按前缀列出 key，返回形状与 memory-kv.js 完全一致：
     *   { keys: [{key}], cursor, complete }
     *
     * 翻页用「上一页最后一个 key」作为游标，下一页查 `key > cursor`。
     * 游标对调用方是不透明的（`kv.js` 的 listKeys 只管拿它继续查）。
     */
    async list({ prefix = '', limit = 500, cursor } = {}) {
      let query = db.from(TABLE).select('key');
      if (prefix) query = query.like('key', `${prefix}%`);
      if (cursor) query = query.gt('key', cursor);

      const rows = unwrap(
        await query.order('key', { ascending: true }).limit(limit),
        `list ${prefix}`,
      );

      const keys = (rows ?? []).map((row) => ({ key: row.key }));
      // 取回来不足 limit 条，说明后面没有了。
      // 正好等于 limit 时会多查一次空页，代价可接受（换来逻辑简单）。
      const complete = keys.length < limit;

      return {
        keys,
        cursor: complete ? undefined : keys[keys.length - 1].key,
        complete,
      };
    },
  };
}
