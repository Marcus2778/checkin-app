/**
 * 密码哈希与会话管理，全部基于 Web Crypto，不依赖任何 npm 包。
 *
 * 为什么是 PBKDF2 而不是 bcrypt/argon2：
 * Edge Functions 不支持和 npm 依赖，而且有 200ms 的 CPU 时间上限，
 * 所以只能用运行时内置的 Web Crypto。PBKDF2 是它提供的唯一密码哈希算法。
 *
 * 迭代次数存在用户记录里（而不是写死在代码里），这样以后调高迭代次数时
 * 老用户仍然能正常登录 —— 密码哈希方案要能平滑升级。
 */

import { ApiError } from './http.js';
import { getJson, putJson, sessionKey, userKey } from './kv.js';

/**
 * PBKDF2 迭代次数。
 *
 * 这个数字是**实测**出来的，不是拍脑袋定的：`node dev/bench-pbkdf2.mjs`
 * 在本机跑 10 万次约 10ms，而 Edge Functions 的 CPU 上限是 200ms。
 * 取 30 万次约 30ms，留了 6 倍余量，边缘节点比本机慢一些也撞不到上限。
 *
 * 之前的 10 万次偏低 —— OWASP 对 PBKDF2-SHA256 的建议值在 60 万次这个量级。
 *
 * ⚠️ KV 绑定好之后要做的第一件事，就是实测一次线上登录耗时来确认这个数。
 * 调高是安全的：老用户下次登录时会自动重算成新标准（见 verifyCredentials）。
 * 但**调低救不了已经注册的用户** —— 迭代次数存在他们各自的记录里，
 * 会继续按旧的高次数校验。
 */
export const PBKDF2_ITERATIONS = 300_000;
const SALT_BYTES = 16;
const SESSION_DAYS = 7;

const encoder = new TextEncoder();

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * 恒定时间比较：普通的 `a === b` 会在第一个不同的字节处提前返回，
 * 攻击者理论上能通过响应耗时逐字节猜出正确的哈希值。
 * 这里始终比完全程，把耗时差异抹平。
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createUser(kv, username, password) {
  if (await getJson(kv, userKey(username))) {
    throw new ApiError('该用户名已被注册', 409);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  const user = {
    username,
    salt: toHex(salt),
    hash: toHex(hash),
    iterations: PBKDF2_ITERATIONS,
    createdAt: new Date().toISOString(),
  };
  await putJson(kv, userKey(username), user);
  return user;
}

export async function verifyCredentials(kv, username, password) {
  const user = await getJson(kv, userKey(username));
  if (!user) {
    // 不区分"用户不存在"和"密码错误"，避免暴露哪些用户名已注册。
    throw new ApiError('用户名或密码错误', 401);
  }
  const actual = await derive(password, fromHex(user.salt), user.iterations);
  if (!timingSafeEqual(actual, fromHex(user.hash))) {
    throw new ApiError('用户名或密码错误', 401);
  }

  // 迭代次数存在用户记录里的意义就在这里：老用户的哈希是按注册当年的标准算的，
  // 而此刻明文密码正好在手上，顺手按当前标准重算一遍存回去。
  // 于是迭代次数可以随时间平滑上涨，不会把老用户锁在旧标准上。
  // （"登录成功的瞬间升级密码哈希"是通行做法，代价只是这一次登录慢一点。）
  if (user.iterations < PBKDF2_ITERATIONS) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    user.salt = toHex(salt);
    user.hash = toHex(await derive(password, salt, PBKDF2_ITERATIONS));
    user.iterations = PBKDF2_ITERATIONS;
    await putJson(kv, userKey(username), user);
  }

  return user;
}

export async function createSession(kv, username) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  // 本地开发用的 KV 客户端只接受 put(key, value) 两个参数，不支持 TTL，
  // 所以过期时间自己记，读取时判断。
  await putJson(kv, sessionKey(token), { username, expiresAt });
  return { token, expiresAt };
}

/** 从 Authorization: Bearer <token> 解析出用户名 */
export async function requireUser(context, kv) {
  const header = context.request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError('未登录', 401);

  const session = await getJson(kv, sessionKey(token));
  if (!session) throw new ApiError('登录已失效，请重新登录', 401);
  if (session.expiresAt < Date.now()) {
    await kv.delete(sessionKey(token));
    throw new ApiError('登录已过期，请重新登录', 401);
  }
  return { username: session.username, token };
}

export async function destroySession(kv, token) {
  if (token) await kv.delete(sessionKey(token));
}

/** 注册和登录时共用的用户名/密码校验 */
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new ApiError('用户名和密码不能为空');
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new ApiError('用户名只能是 3–20 位的字母、数字或下划线');
  }
  if (password.length < 6) {
    throw new ApiError('密码至少 6 位');
  }
  if (password.length > 128) {
    throw new ApiError('密码最长 128 位');
  }
}
