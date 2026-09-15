/**
 * CloudBase 云函数的**真实逻辑**。由同目录的 `index.js`（CommonJS 壳）动态载入。
 *
 * 为什么要有那层壳：CloudBase 的运行时是用 `require()` 加载入口的，**不认 ESM**。
 * 实测过 —— 哪怕运行时是 Node 24（支持 require(esm)），一个 `export function main`
 * 的极简函数也照样崩，报的还是没头没尾的 "0 code exit unexpected"。
 * 所以入口必须是 CommonJS，见 index.js。
 *
 * 而这里以及 `_lib/**`、`api/**` 全部保持 ESM（扩展名 .mjs），
 * 好处是 99 个测试仍然是纯 ESM、不需要任何 CJS 互操作，业务代码一行不用改写。
 *
 * 这一层只做三件事，业务逻辑不在这里：
 *   1. 把 CloudBase 的 HTTP 事件翻译成标准的 Web `Request`
 *   2. 按 `routes.mjs` 找到处理函数并调用
 *   3. 把处理函数返回的 Web `Response` 翻译回 CloudBase 要的「集成响应」
 *
 * 中间那层翻译是整个迁移的关键：`api/**` 下的路由文件和 `_lib` 下所有业务代码
 * 都只认标准的 `Request`/`Response`，所以它们从 EdgeOne 搬过来一行都没改。
 *
 * CloudBase 的 HTTP 事件是 API 网关风格的：
 *   入参 { path, httpMethod, headers, queryStringParameters, body, isBase64Encoded }
 *   返回 { statusCode, headers, body }
 */

import { createCloudbaseKV } from './_lib/kv-cloudbase.mjs';
import { json } from './_lib/http.mjs';
import { matchRoute } from './routes.mjs';

// 云函数实例是长期存活的，一个没人接的 Promise 拒绝会直接杀掉进程，
// 而平台只会报一句没头没尾的 "0 code exit unexpected"，非常难查。
// 这里兜住它：至少留下日志，并且不要让实例死掉。
process.on('unhandledRejection', (reason) => {
  console.error('[checkin] 未处理的 Promise 拒绝:', reason);
});

// 冷启动时注入一次。`_lib/kv.mjs` 的 getKV() 会先看 globalThis，
// 所以业务代码那边什么都不用改。
//
// 初始化失败**不能**让模块加载就崩 —— 那样连 /api/health 都调不到，
// 而自检接口存在的意义正是把这种失败报告出来。所以这里吞掉异常，
// 让失败在真正读写时暴露，由 health 捕获后返回可读的 503。
try {
  globalThis.CHECKIN_KV = createCloudbaseKV();
} catch (error) {
  console.error('[checkin] KV 初始化失败，将由 /api/health 报告:', error);
}

/** CloudBase HTTP 事件 → 标准 Web Request */
function eventToWebRequest(event) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value === undefined || value === null) continue;
    // 有些头会被网关拼成逗号分隔的字符串，原样塞进 Headers 即可
    try {
      headers.set(key, String(value));
    } catch {
      // 极少数非法头名（比如带下划线被某些代理改过）会让 Headers 抛错，跳过即可
    }
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  const search = query.toString();
  const host = headers.get('host') ?? 'localhost';
  const url = `https://${host}${event.path ?? '/'}${search ? `?${search}` : ''}`;

  const method = (event.httpMethod ?? event.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && event.body != null;

  let body;
  if (hasBody) {
    // isBase64Encoded 在不同版本里可能是布尔也可能是字符串 'true'
    const encoded = event.isBase64Encoded === true || event.isBase64Encoded === 'true';
    body = encoded ? Buffer.from(event.body, 'base64') : event.body;
  }

  return new Request(url, { method, headers, body });
}

/** 标准 Web Response → CloudBase 集成响应 */
async function toIntegrationResponse(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // 我们的接口只会返回 JSON，按 utf8 还原就够了。
  // 将来若真要返回图片之类的二进制，这里得按 content-type 判断后转 base64
  // 并把 isBase64Encoded 置为 true。
  const text = await response.text();

  return { statusCode: response.status, headers, body: text };
}

export async function main(event = {}) {
  const matched = matchRoute(event.path);
  if (!matched) {
    return {
      statusCode: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: `没有这个接口: ${event.path ?? '(空路径)'}` }),
    };
  }

  try {
    const request = eventToWebRequest(event);
    const response = await matched.handler({ request, env: process.env });
    return await toIntegrationResponse(response);
  } catch (error) {
    // 走到这里说明连适配层都出问题了（业务异常已经被 withHandler 拦下）。
    // 返回 json() 而不是裸对象，保证错误响应也带上 CORS 头。
    console.error('[checkin] 入口异常:', matched.path, error);
    return toIntegrationResponse(json({ error: '服务器内部错误' }, 500));
  }
}
