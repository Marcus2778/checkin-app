/**
 * 用真实浏览器打开**线上**站点，看看它在各种情况下的表现。
 * 主要用途：KV 还没绑定时，站点处于"API 全 500"状态 —— 这正是
 * 检验错误界面是否可读的最好时机（本地 mock 永远复现不出来）。
 *
 *   node dev/probe-remote.mjs [url]
 */

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'https://checkin-app.edgeone.cool'
const OUT = 'dev/shots'

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({
  viewport: { width: 414, height: 900 },
  deviceScaleFactor: 2,
})

const logs = []
page.on('console', (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

/**
 * 从页面内部请求一个接口。
 *
 * 为什么不用 curl：EdgeOne 的默认域名外面套了一层预览网关，要求浏览器
 * 执行 JS 校验 token，curl 这种"不会跑 JS 的客户端"会被直接挡在 401。
 * 所以自检必须在真实浏览器里做，否则你看到的 401 是网关的，不是应用的。
 */
async function apiGet(path) {
  return page.evaluate(async (p) => {
    const res = await fetch(p)
    return { status: res.status, body: (await res.text()).slice(0, 400) }
  }, path)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

console.log('--- 自检接口 /api/health ---')
const health = await apiGet('/api/health')
console.log('HTTP', health.status)
console.log(health.body)

console.log('页面标题:', await page.title())
console.log('可见文本:', JSON.stringify((await page.locator('body').innerText()).slice(0, 400)))

// 站点可能压根没起来：默认域名的预览链接过期、项目被停、或者平台在维护。
// 这时候拿到的是 EdgeOne 自己的错误页，后面的定位会全部超时，
// 最后报一个跟真实原因毫无关系的 locator 错误。所以先确认加载的是不是我们的应用。
if ((await page.getByRole('button', { name: /注册一个/ }).count()) === 0) {
  console.log('\n⚠️  加载到的不是应用页面 —— 上面那段文本就是平台返回的内容。')
  console.log('   若是 "Access Restricted" 之类的 401，多半是 *.edgeone.cool')
  console.log('   默认域名的预览链接过期了（有时效），跟代码和 KV 都没关系。')
  await browser.close()
  process.exit(1)
}

// 注册一个账号，走到会触发 /api 请求的那一步
await page.getByRole('button', { name: /注册一个/ }).click()
await page.getByLabel('用户名').fill(`probe${Date.now().toString(36).slice(-6)}`)
await page.getByLabel('密码').fill('hunter22')
await page.getByRole('button', { name: '注册' }).click()
await page.waitForTimeout(3000)

console.log('\n--- 注册后 ---')
console.log('可见文本:', JSON.stringify((await page.locator('body').innerText()).slice(0, 600)))
await page.screenshot({ path: `${OUT}/remote-error.png` })
console.log('已截图 remote-error')

if (logs.length) {
  console.log('\n--- 浏览器日志 ---')
  for (const line of logs) console.log(line)
}

await browser.close()
