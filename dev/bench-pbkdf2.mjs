/**
 * 实测一次 PBKDF2 要花多久。
 *
 * 为什么必须实测：Edge Functions 有 **200ms CPU 时间上限**，
 * 而密码哈希是唯一一个 CPU 开销大到可能撞上它的操作。
 * 迭代次数定高了会让登录超时，定低了则不安全 —— 这个数字不该靠猜。
 *
 * 这里直接调用生产代码里的 createUser / verifyCredentials，
 * 不是另写一份等价实现，避免"测的和跑的不是同一段代码"。
 *
 *   node dev/bench-pbkdf2.mjs
 */

import { createUser, verifyCredentials, PBKDF2_ITERATIONS } from '../backend/_lib/auth.mjs'

/** auth.js 需要的 KV 接口：get / put / delete，够用就行 */
function makeFakeKV() {
  const store = new Map()
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
  }
}

const kv = makeFakeKV()

console.log(`当前 PBKDF2_ITERATIONS = ${PBKDF2_ITERATIONS.toLocaleString()}\n`)

// 注册 = 一次哈希
await createUser(kv, 'bench_user', 'hunter22') // 预热，避免把 JIT 编译算进去
const registerRuns = []
for (let i = 0; i < 7; i += 1) {
  const started = performance.now()
  await createUser(kv, `bench_user_${i}`, 'hunter22')
  registerRuns.push(performance.now() - started)
}

// 登录 = 一次哈希 + 一次恒定时间比较
const loginRuns = []
for (let i = 0; i < 7; i += 1) {
  const started = performance.now()
  await verifyCredentials(kv, `bench_user_${i}`, 'hunter22')
  loginRuns.push(performance.now() - started)
}

function report(label, runs) {
  const sorted = [...runs].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  console.log(
    `${label}  中位 ${median.toFixed(1)}ms   最快 ${min.toFixed(1)}ms   最慢 ${max.toFixed(1)}ms`,
  )
  return median
}

report('注册 (createUser)        ', registerRuns)
const loginMedian = report('登录 (verifyCredentials) ', loginRuns)

console.log(`\n200ms CPU 上限下的余量：登录约占 ${((loginMedian / 200) * 100).toFixed(0)}%`)
