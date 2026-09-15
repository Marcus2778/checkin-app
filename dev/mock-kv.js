/**
 * 内存版 KV。用于两处：
 *   1. 单元/集成测试（tests/api.test.js）
 *   2. `npm run dev:mock` 的本地 mock 后端
 *
 * 行为对着 edgeone CLI 里那个本地 KV 客户端实现（edgeone-dist/cli.js
 * 的 createKVClient）抄的，几个关键点必须一致：
 *   - key 只允许字母、数字、下划线
 *   - list 返回 { keys: [{ key }], cursor, complete }
 *   - list 有分页
 */

const KEY_PATTERN = /^[a-zA-Z0-9_]+$/

export function createMockKV({ pageSize = 3 } = {}) {
  const store = new Map()

  function assertKey(key) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new Error(`非法的 KV key（只允许字母、数字、下划线）: ${key}`)
    }
  }

  return {
    /** 测试和 mock 后端可以直接读写底层数据，用来预置历史记录 */
    store,

    async get(key) {
      assertKey(key)
      return store.has(key) ? store.get(key) : null
    },

    async put(key, value) {
      assertKey(key)
      if (typeof value !== 'string') throw new Error('mock KV 只接受字符串 value')
      store.set(key, value)
    },

    async delete(key) {
      assertKey(key)
      store.delete(key)
    },

    async list({ prefix = '', limit = pageSize, cursor } = {}) {
      const all = [...store.keys()].filter((key) => key.startsWith(prefix)).sort()
      const startIndex = cursor ? Math.max(0, all.indexOf(cursor)) : 0
      const size = Math.min(limit, pageSize)
      const page = all.slice(startIndex, startIndex + size)
      const nextIndex = startIndex + page.length
      const complete = nextIndex >= all.length

      return {
        keys: page.map((key) => ({ key })),
        cursor: complete ? undefined : all[nextIndex],
        complete,
      }
    },
  }
}
