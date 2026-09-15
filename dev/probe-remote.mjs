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
// 记下所有失败请求的完整 URL —— 光看控制台的 "404" 不知道是哪个资源挂了
page.on('response', (res) => {
  if (res.status() >= 400) logs.push(`[HTTP ${res.status()}] ${res.url()}`)
})
page.on('requestfailed', (req) => {
  logs.push(`[请求失败] ${req.url()} — ${req.failure()?.errorText ?? ''}`)
})

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
console.log('可见文本:', JSON.stringify((await page.locator('body').innerText()).slice(0, 200)))

// CloudBase 的默认域名会先弹一个"测试域名，仅供开发测试使用"的提示页，
// 要等它自己的倒计时结束、点过「确定访问」才进得去。这只影响浏览器导航，
// 页面内的 fetch 不受影响 —— 所以它是纯前端体验问题，不是接口问题。
const gate = page.getByRole('button', { name: /确定访问/ })
if (await gate.count()) {
  console.log('\n检测到 CloudBase「测试域名」提示页 —— 等一下再点过它')
  await gate.first().waitFor({ state: 'visible' })
  await page.waitForTimeout(3000) // 它自带倒计时，点早了没用
  await gate.first().click()
  await page.waitForTimeout(2000)
  console.log('已进入应用')
}

// 站点可能压根没起来：默认域名的预览链接过期、函数没部署上、或者平台在维护。
// 这时候拿到的是平台自己的错误页，后面的定位会全部超时，
// 最后报一个跟真实原因毫无关系的 locator 错误。所以先确认加载的是不是我们的应用。
if ((await page.getByRole('button', { name: /注册一个/ }).count()) === 0) {
  console.log('\n⚠️  加载到的不是应用页面 —— 上面那段文本就是平台返回的内容。')
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
console.log('可见文本:', JSON.stringify((await page.locator('body').innerText()).slice(0, 300)))
await page.screenshot({ path: `${OUT}/remote-dashboard.png` })

// 走一遍写操作：加任务、勾选。前面 curl 已经验过接口，
// 这里验的是「浏览器 → 网关 → 云函数 → 数据库」整条链路真的串得起来。
const TITLE = `线上验证 ${Date.now().toString(36).slice(-5)}`
console.log(`\n--- 添加任务「${TITLE}」 ---`)
await page.getByRole('button', { name: /添加任务/ }).click()
await page.getByPlaceholder('跑步 800 米').fill(TITLE)
await page.getByRole('button', { name: '保存' }).click()
await page.getByRole('checkbox', { name: TITLE }).waitFor({ timeout: 15_000 })
console.log('✅ 任务已创建')

await page.getByRole('checkbox', { name: TITLE }).locator('..').click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${OUT}/remote-checked.png` })

const text = await page.locator('body').innerText()
console.log('✅ 勾选后今日进度:', /今天要做\s*(\d+\s*\/\s*\d+)/.exec(text)?.[1] ?? '(没读到)')
console.log('✅ 连续天数:', /连续\s*(\d+)\s*天/.exec(text)?.[1] ?? '(没读到)')
console.log('已截图 remote-dashboard / remote-checked')

if (logs.length) {
  console.log('\n--- 浏览器日志 ---')
  for (const line of logs) console.log(line)
}

await browser.close()
