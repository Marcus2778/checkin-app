import { requireUser } from '../../_lib/auth.js';
import { beijingDateString, weekDates } from '../../_lib/date.js';
import { ApiError, json, readJson, withHandler } from '../../_lib/http.js';
import { getKV } from '../../_lib/kv.js';
import { loadCheckinOverview, toggleTask } from '../../_lib/store.js';

/**
 * GET  /api/checkins  一次返回今天的状态、本周 7 天记录和连续打卡统计
 * POST /api/checkins  { taskId, done } 切换某个任务今天的完成状态
 */
const handle = withHandler(async (context) => {
  const kv = getKV(context);
  const { username } = await requireUser(context, kv);

  if (context.request.method === 'GET') {
    return json(await loadCheckinOverview(kv, username, weekDates(beijingDateString())));
  }

  if (context.request.method === 'POST') {
    const { taskId, done } = await readJson(context.request);
    if (typeof taskId !== 'string' || !taskId) throw new ApiError('缺少 taskId');
    if (typeof done !== 'boolean') throw new ApiError('done 必须是布尔值');

    await toggleTask(kv, username, taskId, done);
    // 直接把最新状态回给前端，省一次往返
    return json(await loadCheckinOverview(kv, username, weekDates(beijingDateString())));
  }

  throw new ApiError('只支持 GET / POST', 405);
});

export function onRequest(context) {
  return handle(context);
}
