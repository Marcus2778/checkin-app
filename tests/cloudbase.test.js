import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { main } from '../backend/index.js';
import { ROUTES, matchRoute, normalizePath } from '../backend/routes.js';
import { createMockKV } from '../dev/mock-kv.js';

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'backend',
);

beforeEach(() => {
  // 入口在模块加载时注入的是 CloudBase 的实现；测试里换成内存版，
  // 这样整套适配逻辑（事件翻译 / 路由 / 响应翻译）都不碰真数据库也能测。
  globalThis.CHECKIN_KV = createMockKV();
});

/** 造一个 CloudBase HTTP 网关风格的事件 */
function makeEvent(overrides = {}) {
  return {
    path: '/api/health',
    httpMethod: 'GET',
    headers: { host: 'sm-xxx.api.tcloudbasegateway.com' },
    queryStringParameters: {},
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

describe('路径归一化', () => {
  it('去掉末尾斜杠', () => {
    expect(normalizePath('/api/tasks/')).toBe('/api/tasks');
    expect(normalizePath('/api/tasks///')).toBe('/api/tasks');
  });

  it('去掉 query string', () => {
    expect(normalizePath('/api/tasks?a=1&b=2')).toBe('/api/tasks');
  });

  it('根路径保持为 /', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });

  it('空值不会炸', () => {
    expect(normalizePath(undefined)).toBe('/');
    expect(normalizePath(null)).toBe('/');
  });
});

describe('路由匹配', () => {
  it('精确匹配', () => {
    expect(matchRoute('/api/tasks')?.path).toBe('/api/tasks');
  });

  it('网关把 /api 前缀剥掉时也能匹配上', () => {
    expect(matchRoute('/tasks')?.path).toBe('/api/tasks');
    expect(matchRoute('/auth/login')?.path).toBe('/api/auth/login');
  });

  it('未知路径返回 null', () => {
    expect(matchRoute('/api/nope')).toBeNull();
    expect(matchRoute('/totally/else')).toBeNull();
  });

  it('路由表与 api/ 目录下的文件完全对得上', () => {
    // 这条是防漂移的关键：新增了接口文件却忘了在 routes.js 里注册，
    // 生产环境会 404 而本地开发照常能跑（本地是按文件路由的），很难发现。
    const expected = [];
    const walk = (dir, prefix) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full, `${prefix}/${entry}`);
        } else if (entry.endsWith('.js')) {
          const name = entry.slice(0, -3);
          // tasks/index.js → /api/tasks；auth/login.js → /api/auth/login
          expected.push(name === 'index' ? `/api${prefix}` : `/api${prefix}/${name}`);
        }
      }
    };
    walk(path.join(backendRoot, 'api'), '');

    expect([...expected].sort()).toEqual(Object.keys(ROUTES).sort());
  });
});

describe('CloudBase 事件适配', () => {
  it('GET 请求走通整条链路，返回集成响应', async () => {
    const result = await main(makeEvent());

    // 集成响应的形状：{ statusCode, headers, body }
    expect(result.statusCode).toBe(200);
    expect(typeof result.body).toBe('string');
    expect(result.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(result.body);
    expect(payload.ok).toBe(true);
    expect(payload.kv).toBe('bound');
  });

  it('未知路径返回 404 而不是崩掉', async () => {
    const result = await main(makeEvent({ path: '/api/does-not-exist' }));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toContain('/api/does-not-exist');
  });

  it('Authorization 头能传到业务代码', async () => {
    const result = await main(
      makeEvent({
        path: '/api/tasks',
        headers: { host: 'x', authorization: 'Bearer not-a-real-token' },
      }),
    );
    // 没带有效会话，应该是 401 —— 说明头确实传进去了（否则会是别的错）
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toContain('登录');
  });

  it('POST + base64 body 能正确解码', async () => {
    const payload = { username: 'b64user', password: 'hunter22' };
    const result = await main(
      makeEvent({
        path: '/api/auth/register',
        httpMethod: 'POST',
        headers: { host: 'x', 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        isBase64Encoded: true,
      }),
    );
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).username).toBe('b64user');
  });

  it("isBase64Encoded 是字符串 'true' 时也认", async () => {
    // 不同版本的网关给的类型不一样，布尔和字符串都得处理
    const payload = { username: 'strb64', password: 'hunter22' };
    const result = await main(
      makeEvent({
        path: '/api/auth/register',
        httpMethod: 'POST',
        headers: { host: 'x', 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        isBase64Encoded: 'true',
      }),
    );
    expect(result.statusCode).toBe(201);
  });

  it('未编码的 body 原样使用', async () => {
    const payload = { username: 'plainuser', password: 'hunter22' };
    const result = await main(
      makeEvent({
        path: '/api/auth/register',
        httpMethod: 'POST',
        headers: { host: 'x', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        isBase64Encoded: false,
      }),
    );
    expect(result.statusCode).toBe(201);
  });

  it('空 path 不会炸', async () => {
    const result = await main(makeEvent({ path: undefined }));
    expect(result.statusCode).toBe(404);
  });

  it('CORS 预检返回 204', async () => {
    const result = await main(
      makeEvent({
        path: '/api/tasks',
        httpMethod: 'OPTIONS',
        headers: { host: 'x', origin: 'https://example.com' },
      }),
    );
    expect(result.statusCode).toBe(204);
  });
});
