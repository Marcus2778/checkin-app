/**
 * 用真实浏览器把应用跑一遍并截图，用来检查界面。
 * 需要先启动 `npm run dev:mock`（内存后端，不需要 EdgeOne 账号）。
 *
 *   node dev/screenshot.mjs
 */

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = 'dev/shots'
// 每次跑用不同的账号，避免和上一次的数据冲突
const USERNAME = `shot${Date.now().toString(36).slice(-8)}`

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({
  viewport: { width: 414, height: 900 },
  deviceScaleFactor: 2,
})

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('已截图', name)
}

/** 勾选任务 */
async function toggle(taskTitle) {
  await page.getByRole('checkbox', { name: taskTitle }).locator('..').click()
  await page.waitForTimeout(350)
}

/** 通过底部那条行内编辑器添加任务 */
async function addTask(title, type = 'daily') {
  await page.getByRole('button', { name: /添加任务/ }).click()
  await page.getByPlaceholder('跑步 800 米').fill(title)
  if (type === 'once') {
    await page.getByRole('button', { name: '只做一次' }).click()
  }
  await page.getByRole('button', { name: '保存' }).click()
  // 编辑器保存失败时会留在原地不报错，所以这里必须确认任务真的出现了，
  // 否则失败会被静默吞掉、后面报一个莫名其妙的定位错误。
  await page.getByRole('checkbox', { name: title }).waitFor({ timeout: 5_000 })
}

await page.goto(BASE)
await shot('1-login')

await page.getByRole('button', { name: /注册一个/ }).click()
await page.getByLabel('用户名').fill(USERNAME)
await page.getByLabel('密码').fill('hunter22')
await page.getByRole('button', { name: '注册' }).click()

await page.getByText('今天要做').waitFor({ timeout: 10_000 })
await shot('2-empty')

await addTask('跑步 800 米')
await addTask('背单词 50 个')
await addTask('读完《人类简史》', 'once')

// 昨天（本周一）盖过，再往前补 5 天 —— 印记连成一段，今天那格还空着
await page.request.post(`${BASE}/api/__seed`, {
  data: { username: USERNAME, days: 1, skip: 0 },
})
await page.request.post(`${BASE}/api/__seed`, {
  data: { username: USERNAME, days: 5, skip: 1 },
})
await page.reload()
await page.getByText('今天要做').waitFor()
await page.waitForTimeout(500)
await shot('3-tasks')

// 只勾一项：今天那枚章只填到三分之一高度
await toggle('跑步 800 米')
await shot('4-partial')

// 全部勾完：今天盖章
await toggle('背单词 50 个')
await toggle('读完《人类简史》')
await page.waitForTimeout(500)
await shot('5-complete')

// 点任务文字进入行内编辑
await page.getByRole('button', { name: '跑步 800 米' }).click()
await page.waitForTimeout(300)
await shot('6-inline-edit')
await page.keyboard.press('Escape')

// 桌面宽度
await page.setViewportSize({ width: 1100, height: 950 })
await page.waitForTimeout(400)
await shot('7-desktop')

await browser.close()
console.log('完成')
