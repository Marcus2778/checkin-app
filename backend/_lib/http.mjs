/** HTTP 响应与请求解析的小工具，让各路由函数保持简短。 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // 前端和函数同源，正常用不到 CORS；加上是为了方便你本地用别的端口调试前端。
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** 业务错误：抛出后由 withHandler 统一转成 JSON 响应 */
export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch {
    throw new ApiError('请求体必须是合法的 JSON 对象');
  }
}

/** 包一层，统一处理 CORS 预检和错误响应 */
export function withHandler(handler) {
  return async (context) => {
    if (context.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error('[api] 未处理的异常:', error);
      return json({ error: '服务器内部错误' }, 500);
    }
  };
}
