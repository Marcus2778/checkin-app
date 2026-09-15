/**
 * 本地 mock 后端（仅开发用，通过 `npm run dev:mock` 启用）。
 *
 * 关键点：它**直接复用 backend/api 下真实的路由处理函数**，
 * 只把 KV 换成内存实现。所以这里不会出现"mock 和线上逻辑不一致"的问题 ——
 * 你在本地调出来的行为就是部署后的行为。
 *
 * 这样安排还有个好处：不需要先注册云服务、开通数据库就能把前端跑起来。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMockKV } from './mock-kv.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(projectRoot, 'backend', 'api')

/** 把 /api/auth/login 映射到 backend/api/auth/login.js */
function resolveHandlerPath(pathname) {
  const relative = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '')
  if (!relative || relative.includes('..')) return null

  const candidates = [
    path.join(apiRoot, `${relative}.mjs`),
    path.join(apiRoot, relative, 'index.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function toWebRequest(nodeRequest) {
  const url = new URL(nodeRequest.url, 'http://localhost')
  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeRequest.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else if (value !== undefined) headers.set(key, value)
  }

  let body
  if (nodeRequest.method !== 'GET' && nodeRequest.method !== 'HEAD') {
    const chunks = []
    for await (const chunk of nodeRequest) chunks.push(chunk)
    body = Buffer.concat(chunks)
  }

  return new Request(url, { method: nodeRequest.method, headers, body })
}

async function sendWebResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status
  response.headers.forEach((value, key) => nodeResponse.setHeader(key, value))
  const buffer = Buffer.from(await response.arrayBuffer())
  nodeResponse.end(buffer)
}

export function mockApi() {
  return {
    name: 'checkin-mock-api',
    configureServer(server) {
      // pageSize 给大一点，本地开发时不需要真的翻页
      const kv = createMockKV({ pageSize: 1000 })
      globalThis.CHECKIN_KV = kv

      server.middlewares.use(async (nodeRequest, nodeResponse, next) => {
        const url = new URL(nodeRequest.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        // 开发辅助：一键造出过去几天的打卡历史，方便看周视图的样子
        if (url.pathname === '/api/__seed' && nodeRequest.method === 'POST') {
          const chunks = []
          for await (const chunk of nodeRequest) chunks.push(chunk)
          const { username, days, skip, today } = JSON.parse(
            Buffer.concat(chunks).toString() || '{}',
          )
          const count = Number(days ?? 5)
          // skip=1 表示跳过昨天，从"前天"开始往前造 —— 用来制造出缺口看效果
          const startOffset = Number(skip ?? 0) + 1
          const base = new Date(`${today ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`)
          let seeded = 0
          for (let offset = startOffset; offset < startOffset + count; offset += 1) {
            const date = new Date(base)
            date.setUTCDate(date.getUTCDate() - offset)
            const iso = date.toISOString().slice(0, 10)
            kv.store.set(
              `rec_${username}_${iso.replace(/-/g, '')}`,
              JSON.stringify({ completedAt: `${iso}T04:00:00.000Z` }),
            )
            seeded += 1
          }
          nodeResponse.setHeader('content-type', 'application/json')
          nodeResponse.end(JSON.stringify({ seeded }))
          return
        }

        const handlerPath = resolveHandlerPath(url.pathname)
        if (!handlerPath) return next()

        try {
          // 用 ssrLoadModule 而不是原生 import()：
          // 原生 import 只给路由文件本身做缓存穿透，它内部 import 的 _lib/*.js
          // 仍会被 ESM 缓存住，改了 _lib 却不生效（很难查）。
          // ssrLoadModule 把整条模块链纳入 Vite 的模块图，改哪个都会热更新。
          const module = await server.ssrLoadModule(handlerPath)
          const response = await module.onRequest({
            request: await toWebRequest(nodeRequest),
            env: {},
          })
          await sendWebResponse(nodeResponse, response)
        } catch (error) {
          console.error('[mock-api]', url.pathname, error)
          nodeResponse.statusCode = 500
          nodeResponse.setHeader('content-type', 'application/json')
          nodeResponse.end(JSON.stringify({ error: String(error?.message ?? error) }))
        }
      })
    },
  }
}
