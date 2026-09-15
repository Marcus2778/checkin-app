import { requireUser } from '../../_lib/auth.mjs';
import { ApiError, json, readJson, withHandler } from '../../_lib/http.mjs';
import { getKV } from '../../_lib/kv.mjs';
import {
  addTask,
  deleteTask,
  loadTasks,
  resyncToday,
  updateTask,
  validateTaskInput,
} from '../../_lib/store.mjs';

/**
 * GET    /api/tasks         任务列表
 * POST   /api/tasks         新建
 * PATCH  /api/tasks         编辑 / 归档
 * DELETE /api/tasks         删除
 *
 * 每次改动后都会重新判定"今天算不算完成" —— 比如你打完卡又加了一个任务，
 * 今天就不再是完成状态了；反过来删掉最后一个没做的任务，今天会立刻变成已完成。
 */
const handle = withHandler(async (context) => {
  const kv = getKV(context);
  const { username } = await requireUser(context, kv);
  const method = context.request.method;

  if (method === 'GET') {
    const tasks = await loadTasks(kv, username);
    return json({ tasks });
  }

  if (method === 'POST') {
    const input = validateTaskInput(await readJson(context.request));
    const task = await addTask(kv, username, input);
    const complete = await resyncToday(kv, username);
    return json({ task, complete }, 201);
  }

  if (method === 'PATCH') {
    const body = await readJson(context.request);
    const patch = validateTaskInput(body, { partial: true });
    const task = await updateTask(kv, username, body.id, patch, body.archived);
    const complete = await resyncToday(kv, username);
    return json({ task, complete });
  }

  if (method === 'DELETE') {
    const body = await readJson(context.request);
    await deleteTask(kv, username, body.id);
    const complete = await resyncToday(kv, username);
    return json({ ok: true, complete });
  }

  throw new ApiError('只支持 GET / POST / PATCH / DELETE', 405);
});

export function onRequest(context) {
  return handle(context);
}
