/**
 * 路由表：接口路径 → 处理函数。
 *
 * 这是**一份**事实来源。生产（CloudBase 云函数）直接用它；本地开发服务器
 * 走的是「路径 → 文件」的约定（因为要保留 Vite 的模块热更新），两者可能漂移。
 * `tests/routes.test.js` 会断言这张表和 `api/` 下的文件完全对得上 —— 加了
 * 新接口却忘了注册，测试会先红。
 *
 * 云函数入口收到的是 API 网关风格的事件，路径在 `event.path` 里，
 * 所以这里必须是显式映射，不能像边缘函数那样靠文件系统路由。
 */

import { onRequest as checkins } from './api/checkins/index.js';
import { onRequest as health } from './api/health.js';
import { onRequest as login } from './api/auth/login.js';
import { onRequest as logout } from './api/auth/logout.js';
import { onRequest as register } from './api/auth/register.js';
import { onRequest as tasks } from './api/tasks/index.js';

export const ROUTES = {
  '/api/health': health,
  '/api/auth/register': register,
  '/api/auth/login': login,
  '/api/auth/logout': logout,
  '/api/tasks': tasks,
  '/api/checkins': checkins,
};

/**
 * 把事件的 path 归一化成路由表里的键。
 *
 * HTTP 网关转发时，`event.path` 到底是 `/api/tasks` 还是 `/tasks` 取决于
 * 路由怎么配的。两边都试一下，省得因为这种小事排查半天。
 */
export function normalizePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath) return '/';
  let path = rawPath.split('?')[0];
  // 去掉末尾斜杠（但保留根路径的 '/'）
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

/** 找出这个路径该由哪个处理函数负责；找不到返回 null */
export function matchRoute(rawPath) {
  const path = normalizePath(rawPath);
  if (ROUTES[path]) return { path, handler: ROUTES[path] };
  // 网关把 /api 前缀剥掉的情况
  const withPrefix = `/api${path}`;
  if (ROUTES[withPrefix]) return { path: withPrefix, handler: ROUTES[withPrefix] };
  return null;
}
