import { beforeEach, describe, expect, it } from 'vitest'
import { onRequest as checkinsRoute } from '../backend/api/checkins/index.mjs'
import { onRequest as healthRoute } from '../backend/api/health.mjs'
import { onRequest as loginRoute } from '../backend/api/auth/login.mjs'
import { onRequest as logoutRoute } from '../backend/api/auth/logout.mjs'
import { onRequest as registerRoute } from '../backend/api/auth/register.mjs'
import { onRequest as tasksRoute } from '../backend/api/tasks/index.mjs'
import { PBKDF2_ITERATIONS } from '../backend/_lib/auth.mjs'
import { addDays, beijingDateString } from '../backend/_lib/date.mjs'
import { createMockKV } from '../dev/mock-kv.js'

let kv
let today

beforeEach(() => {
  kv = createMockKV()
  globalThis.CHECKIN_KV = kv
  today = beijingDateString()
})

/** 直接调用路由处理函数，模拟一次 HTTP 请求 */
async function call(handler, { method = 'GET', body, token } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const request = new Request('http://localhost/api', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await handler({ request })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function signUp(username = 'alice', password = 'hunter22') {
  const result = await call(registerRoute, { method: 'POST', body: { username, password } })
  expect(result.status).toBe(201)
  return result.body.token
}

/** 预置历史打卡记录，模拟"这个人前些天打过卡" */
function seedCompletedDays(username, dateStrings) {
  for (const date of dateStrings) {
    kv.store.set(
      `rec_${username}_${date.replace(/-/g, '')}`,
      JSON.stringify({ completedAt: `${date}T00:00:00.000Z` }),
    )
  }
}

/** 生成从 endDate 往回数的连续日期 */
function consecutive(endDate, count) {
  return Array.from({ length: count }, (_, index) => addDays(endDate, -(count - 1 - index)))
}

describe('注册与登录', () => {
  it('注册成功返回 token', async () => {
    const result = await call(registerRoute, {
      method: 'POST',
      body: { username: 'alice', password: 'hunter22' },
    })
    expect(result.status).toBe(201)
    expect(result.body.username).toBe('alice')
    expect(result.body.token).toBeTruthy()
    // 响应里绝不能带上密码或哈希
    expect(JSON.stringify(result.body)).not.toContain('hunter22')
  })

  it('用户名重复返回 409', async () => {
    await signUp('alice')
    const again = await call(registerRoute, {
      method: 'POST',
      body: { username: 'alice', password: 'another1' },
    })
    expect(again.status).toBe(409)
  })

  it('用户名含 KV key 不允许的字符时被拒（否则会写出非法 key）', async () => {
    for (const username of ['ab', 'a-b', 'a b', 'a:b', '用户名']) {
      const result = await call(registerRoute, {
        method: 'POST',
        body: { username, password: 'hunter22' },
      })
      expect(result.status, `用户名 ${username} 应该被拒绝`).toBe(400)
    }
  })

  it('密码太短被拒', async () => {
    const result = await call(registerRoute, {
      method: 'POST',
      body: { username: 'alice', password: '123' },
    })
    expect(result.status).toBe(400)
  })

  it('密码错误返回 401，且提示不区分用户是否存在', async () => {
    await signUp('alice')
    const wrongPassword = await call(loginRoute, {
      method: 'POST',
      body: { username: 'alice', password: 'wrongpass' },
    })
    const noSuchUser = await call(loginRoute, {
      method: 'POST',
      body: { username: 'nobody', password: 'wrongpass' },
    })
    expect(wrongPassword.status).toBe(401)
    expect(noSuchUser.status).toBe(401)
    expect(wrongPassword.body.error).toBe(noSuchUser.body.error)
  })

  it('登录成功返回新 token', async () => {
    await signUp('alice')
    const result = await call(loginRoute, {
      method: 'POST',
      body: { username: 'alice', password: 'hunter22' },
    })
    expect(result.status).toBe(200)
    expect(result.body.token).toBeTruthy()
  })

  it('退出后 token 失效', async () => {
    const token = await signUp('alice')
    await call(logoutRoute, { method: 'POST', token })
    const after = await call(tasksRoute, { token })
    expect(after.status).toBe(401)
  })

  it('伪造的 token 被拒', async () => {
    await signUp('alice')
    const result = await call(tasksRoute, { token: 'deadbeef'.repeat(8) })
    expect(result.status).toBe(401)
  })
})

describe('任务管理', () => {
  it('未登录不能访问', async () => {
    expect((await call(tasksRoute)).status).toBe(401)
    expect((await call(checkinsRoute)).status).toBe(401)
  })

  it('新建、编辑、删除任务', async () => {
    const token = await signUp()

    const created = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '跑步 800 米', type: 'daily' },
    })
    expect(created.status).toBe(201)
    expect(created.body.task.title).toBe('跑步 800 米')

    const listed = await call(tasksRoute, { token })
    expect(listed.body.tasks).toHaveLength(1)

    const edited = await call(tasksRoute, {
      method: 'PATCH',
      token,
      body: { id: created.body.task.id, title: '跑步 1000 米' },
    })
    expect(edited.body.task.title).toBe('跑步 1000 米')

    await call(tasksRoute, { method: 'DELETE', token, body: { id: created.body.task.id } })
    expect((await call(tasksRoute, { token })).body.tasks).toHaveLength(0)
  })

  it('任务名不能为空', async () => {
    const token = await signUp()
    const result = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '   ', type: 'daily' },
    })
    expect(result.status).toBe(400)
  })

  it('非法任务类型被拒', async () => {
    const token = await signUp()
    const result = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '运动', type: 'weekly' },
    })
    expect(result.status).toBe(400)
  })
})

describe('打卡流程', () => {
  it('全部完成才点亮当天', async () => {
    const token = await signUp()
    const a = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '运动', type: 'daily' },
    })
    const b = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '背单词', type: 'daily' },
    })

    let overview = await call(checkinsRoute, { token })
    expect(overview.body.today.todoCount).toBe(2)
    expect(overview.body.today.complete).toBe(false)

    // 只勾一项：不算完成
    const first = await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: a.body.task.id, done: true },
    })
    expect(first.body.today.complete).toBe(false)
    expect(first.body.week.find((day) => day.isToday).partial).toBe(true)

    // 勾完第二项：当天完成，连续变 1
    const second = await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: b.body.task.id, done: true },
    })
    expect(second.body.today.complete).toBe(true)
    expect(second.body.stats.current).toBe(1)
    expect(second.body.stats.longest).toBe(1)
    expect(second.body.week.find((day) => day.isToday).complete).toBe(true)

    // 取消一项：完成状态要退回去
    const undone = await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: a.body.task.id, done: false },
    })
    expect(undone.body.today.complete).toBe(false)
    expect(undone.body.stats.current).toBe(0)
    expect(kv.store.has(`rec_alice_${today.replace(/-/g, '')}`)).toBe(false)

    // 重新勾上
    const redone = await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: a.body.task.id, done: true },
    })
    expect(redone.body.today.complete).toBe(true)
  })

  it('打卡时新增任务，当天会退回未完成', async () => {
    const token = await signUp()
    const a = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '运动', type: 'daily' },
    })
    await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: a.body.task.id, done: true },
    })
    expect((await call(checkinsRoute, { token })).body.today.complete).toBe(true)

    await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '新任务', type: 'daily' },
    })
    expect((await call(checkinsRoute, { token })).body.today.complete).toBe(false)
  })

  it('一次性任务完成后不再出现在待办里', async () => {
    const token = await signUp()
    const once = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '读完一本书', type: 'once' },
    })
    const daily = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '运动', type: 'daily' },
    })

    expect((await call(checkinsRoute, { token })).body.today.todoCount).toBe(2)
    await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: daily.body.task.id, done: true },
    })
    const after = await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: once.body.task.id, done: true },
    })
    // 一次性任务是今天的最后一项，勾完当天应该算完成
    expect(after.body.today.complete).toBe(true)
    expect(after.body.today.todoCount).toBe(2)
  })

  it('请求里带日期参数也没用（结构上就不可能补卡）', async () => {
    const token = await signUp()
    const task = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '运动', type: 'daily' },
    })
    await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: task.body.task.id, done: true, date: '2020-01-01', dateKey: '20200101' },
    })
    const pastKeys = [...kv.store.keys()].filter((key) => key.includes('20200101'))
    expect(pastKeys).toEqual([])
  })
})

describe('连续打卡统计', () => {
  it('连续 5 天到昨天，当前连续算 5（今天还没过完）', async () => {
    const token = await signUp()
    seedCompletedDays('alice', consecutive(addDays(today, -1), 5))

    const { body } = await call(checkinsRoute, { token })
    expect(body.stats.current).toBe(5)
    expect(body.stats.longest).toBe(5)
    expect(body.stats.total).toBe(5)
  })

  it('中间断了：最长取最长的那一段，当前归零', async () => {
    const token = await signUp()
    seedCompletedDays('alice', [
      ...consecutive(addDays(today, -10), 4), // 很久以前的连续 4 天
      ...consecutive(addDays(today, -1), 2), // 昨天和前天
    ])

    const { body } = await call(checkinsRoute, { token })
    expect(body.stats.longest).toBe(4)
    expect(body.stats.current).toBe(2)
    expect(body.stats.total).toBe(6)
  })

  it('今天完成打卡后，当前连续 +1 并接到历史上去', async () => {
    const token = await signUp()
    seedCompletedDays('alice', consecutive(addDays(today, -1), 3))
    const task = await call(tasksRoute, {
      method: 'POST',
      token,
      body: { title: '运动', type: 'daily' },
    })

    const { body } = await call(checkinsRoute, {
      method: 'POST',
      token,
      body: { taskId: task.body.task.id, done: true },
    })
    expect(body.stats.current).toBe(4)
    expect(body.stats.longest).toBe(4)
    expect(body.stats.total).toBe(4)
  })

  it('记录很多时也能翻页取全（mock KV 每页只给 3 条）', async () => {
    const token = await signUp()
    const many = consecutive(today, 20)
    seedCompletedDays('alice', many)

    const { body } = await call(checkinsRoute, { token })
    // 20 条记录要翻 7 页才能取全，取不全的话这里会明显偏小
    expect(body.stats.total).toBe(20)
    expect(body.stats.longest).toBe(20)
    expect(body.stats.current).toBe(20)
  })

  it('周视图固定 7 天，未来日期标记出来', async () => {
    const token = await signUp()
    const { body } = await call(checkinsRoute, { token })
    expect(body.week).toHaveLength(7)
    expect(body.week.filter((day) => day.isToday)).toHaveLength(1)
    // 周一是一周的第一天
    expect(new Date(`${body.week[0].date}T00:00:00Z`).getUTCDay()).toBe(1)
  })
})

describe('账号隔离', () => {
  it('两个用户互相看不到对方的任务和记录', async () => {
    const aliceToken = await signUp('alice')
    const bobToken = await signUp('bob')

    const task = await call(tasksRoute, {
      method: 'POST',
      token: aliceToken,
      body: { title: 'alice 的任务', type: 'daily' },
    })
    await call(checkinsRoute, {
      method: 'POST',
      token: aliceToken,
      body: { taskId: task.body.task.id, done: true },
    })

    const bobTasks = await call(tasksRoute, { token: bobToken })
    const bobOverview = await call(checkinsRoute, { token: bobToken })

    expect(bobTasks.body.tasks).toEqual([])
    expect(bobOverview.body.stats.total).toBe(0)
    expect(bobOverview.body.today.complete).toBe(false)
  })

  it('用户名相近也不会串数据', async () => {
    const aliceToken = await signUp('alice')
    const alice2Token = await signUp('alice2')

    seedCompletedDays('alice', consecutive(today, 3))

    const alice2 = await call(checkinsRoute, { token: alice2Token })
    expect(alice2.body.stats.total).toBe(0)

    const alice = await call(checkinsRoute, { token: aliceToken })
    expect(alice.body.stats.total).toBe(3)
  })
})

/**
 * 手写一条"旧版代码留下的"用户记录：迭代次数还是当年的低标准。
 * 这里刻意自己算一遍 PBKDF2 而不用 auth.js 里的函数 —— 要测的就是
 * "用旧标准存下来的记录，能不能被新代码正确接手"。
 */
async function seedLegacyUser(username, password, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

  kv.store.set(
    `user_${username}`,
    JSON.stringify({
      username,
      salt: hex(salt),
      hash: hex(new Uint8Array(bits)),
      iterations,
      createdAt: new Date().toISOString(),
    }),
  )
}

describe('密码哈希的平滑升级', () => {
  it('老用户登录成功后，迭代次数升到当前标准', async () => {
    await seedLegacyUser('olduser', 'hunter22', 1_000)
    const before = JSON.parse(kv.store.get('user_olduser'))
    expect(before.iterations).toBe(1_000)

    const result = await call(loginRoute, {
      method: 'POST',
      body: { username: 'olduser', password: 'hunter22' },
    })
    expect(result.status).toBe(200)

    const after = JSON.parse(kv.store.get('user_olduser'))
    expect(after.iterations).toBe(PBKDF2_ITERATIONS)
    expect(after.hash).not.toBe(before.hash)
    // salt 也换了：新哈希配新 salt，不能沿用旧的
    expect(after.salt).not.toBe(before.salt)
  })

  it('升级之后原密码仍然能登录', async () => {
    await seedLegacyUser('olduser', 'hunter22', 1_000)
    await call(loginRoute, {
      method: 'POST',
      body: { username: 'olduser', password: 'hunter22' },
    })

    const again = await call(loginRoute, {
      method: 'POST',
      body: { username: 'olduser', password: 'hunter22' },
    })
    expect(again.status).toBe(200)
    expect(again.body.token).toBeTruthy()
  })

  it('密码错误时不会升级（失败不该产生写入）', async () => {
    await seedLegacyUser('olduser', 'hunter22', 1_000)

    const result = await call(loginRoute, {
      method: 'POST',
      body: { username: 'olduser', password: 'wrongpass' },
    })
    expect(result.status).toBe(401)

    // 关键：登录失败必须原样不动。否则拿别人的用户名乱撞密码，
    // 每次都能触发一次 30 万次的哈希重算，等于白送攻击者一个放大器。
    expect(JSON.parse(kv.store.get('user_olduser')).iterations).toBe(1_000)
  })
})

describe('自检接口', () => {
  it('KV 可用时返回 ok', async () => {
    const result = await call(healthRoute)
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.binding).toBe('CHECKIN_KV')
  })

  it('KV 没绑定时返回 503，并把变量名和怎么办写清楚', async () => {
    delete globalThis.CHECKIN_KV

    const result = await call(healthRoute)
    expect(result.status).toBe(503)
    expect(result.body.ok).toBe(false)
    expect(result.body.kv).toBe('missing')
    // 提示里必须点名 CHECKIN_KV —— 绑错变量名是这一步最常见的错法
    expect(result.body.hint).toContain('CHECKIN_KV')
  })

  it('不需要登录也能访问（部署出问题时得先能打开它）', async () => {
    const result = await call(healthRoute) // 不传 token
    expect(result.status).toBe(200)
  })
})

describe('畸形 token 的防御', () => {
  // 这组是回归测试。原来的代码把客户端传来的 token 直接拼进 KV 的 key，
  // 而 KV 的 key 只允许 [a-zA-Z0-9_]，于是带连字符的 token 会让底层存储抛错，
  // 对外表现成 500 而不是 401。迁移到 CloudBase 时被新加的适配层测试逮到。

  const MALFORMED = [
    'not-a-real-token', // 连字符 —— 就是它触发了原来的 500
    '', // 空
    'a'.repeat(63), // 少一位
    'a'.repeat(65), // 多一位
    'A'.repeat(64), // 大写 hex，不在允许的形状里
    'zzzz'.repeat(16), // 长度对但不是 hex
    "'; DROP TABLE kv; --", // 想看看有没有拼串的机会
  ]

  for (const token of MALFORMED) {
    it(`token=${JSON.stringify(token.slice(0, 24))} 时返回 401 而不是 500`, async () => {
      const result = await call(tasksRoute, { token })
      expect(result.status).toBe(401)
      expect(result.body.error).toContain('登录')
    })
  }

  it('登出接口拿到畸形 token 也不能崩', async () => {
    const result = await call(logoutRoute, { method: 'POST', token: 'not-a-real-token' })
    // 登出是幂等的：token 没形状就当没登录，返回成功即可，绝不能 500
    expect(result.status).toBe(200)
  })

  it('形状合法但不存在的 token 仍然走正常路径返回 401', async () => {
    const result = await call(tasksRoute, { token: 'a'.repeat(64) })
    expect(result.status).toBe(401)
    expect(result.body.error).toContain('登录已失效')
  })
})
