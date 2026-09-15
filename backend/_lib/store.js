/**
 * 业务数据层：任务、打卡进度、当天完成判定。
 *
 * 核心设计（也是这个项目里最值得看的一处）：
 * `rec_<用户名>_<YYYYMMDD>` 这个 key **只在该日全部完成时才存在**。
 * 于是"哪些天打了卡"= `list({ prefix: 'rec_用户名_' })` 拿到的 key 列表，
 * 连续打卡统计完全不需要读取任何 value。
 * 这是 KV 存储的正确用法 —— 用 key 本身承载可枚举的事实，避免全表扫描。
 *
 * 与之相对，`prog_<用户名>_<YYYYMMDD>` 存当天勾了哪些任务，只在渲染
 * 周详情时才需要读。
 */

import { ApiError } from './http.js';
import { beijingDateKey, beijingDateString } from './date.js';
import {
  dateKeyFromRecordKey,
  getJson,
  listKeys,
  progressKey,
  putJson,
  recordKey,
  tasksKey,
} from './kv.js';
import { computeStreaks } from './streak.js';

export const TASK_TYPES = ['daily', 'once'];
const MAX_TITLE = 60;
const MAX_TASKS = 50;

function newId() {
  return crypto.getRandomValues(new Uint8Array(8)).reduce(
    (hex, byte) => hex + byte.toString(16).padStart(2, '0'),
    '',
  );
}

/* ---------- 任务读写 ---------- */

export async function loadTasks(kv, username) {
  return (await getJson(kv, tasksKey(username))) ?? [];
}

async function saveTasks(kv, username, tasks) {
  await putJson(kv, tasksKey(username), tasks);
}

/**
 * 任务就是一行字：「跑步 800 米」这样。
 * 不再拆成"名称 + 内容"两栏 —— 打卡场景下拆开只是多一次输入，
 * 「运动 / 跑步 800 米」和「跑步 800 米」记的是同一件事。
 */
export function validateTaskInput(body, { partial = false } = {}) {
  const patch = {};

  if (!partial || body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw new ApiError('任务不能为空');
    if (title.length > MAX_TITLE) throw new ApiError(`任务最长 ${MAX_TITLE} 个字`);
    patch.title = title;
  }

  if (!partial || body.type !== undefined) {
    const type = body.type ?? 'daily';
    if (!TASK_TYPES.includes(type)) throw new ApiError('任务类型只能是 daily 或 once');
    patch.type = type;
  }

  return patch;
}

export async function addTask(kv, username, input) {
  const tasks = await loadTasks(kv, username);
  if (tasks.filter((task) => !task.archived).length >= MAX_TASKS) {
    throw new ApiError(`最多只能有 ${MAX_TASKS} 个进行中的任务`);
  }
  const task = {
    id: newId(),
    ...input,
    archived: false,
    completedAt: null,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  await saveTasks(kv, username, tasks);
  return task;
}

export async function updateTask(kv, username, taskId, patch, archived) {
  const tasks = await loadTasks(kv, username);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new ApiError('任务不存在', 404);

  Object.assign(task, patch);
  if (archived !== undefined) task.archived = Boolean(archived);
  await saveTasks(kv, username, tasks);
  return task;
}

export async function deleteTask(kv, username, taskId) {
  const tasks = await loadTasks(kv, username);
  const next = tasks.filter((item) => item.id !== taskId);
  if (next.length === tasks.length) throw new ApiError('任务不存在', 404);
  await saveTasks(kv, username, next);
}

/* ---------- 当天的应做任务 ---------- */

/**
 * 给定日期下"应该做"的任务。
 * - 归档的任务不算
 * - daily 任务每天都要重新做
 * - once 任务完成后就不再出现；但如果它是在**当天**完成的，当天仍然算数
 *   （否则"只有一个一次性任务"的用户永远无法完成打卡）
 */
export function todoTasksFor(tasks, dateString) {
  return tasks.filter((task) => {
    if (task.archived) return false;
    if (task.type !== 'once') return true;
    if (!task.completedAt) return true;
    return task.completedAt === dateString;
  });
}

/** 今天是否算"全部完成"：至少有一个任务，且应做的都勾了 */
export function isDayComplete(tasks, dateString, doneIds) {
  const todo = todoTasksFor(tasks, dateString);
  if (todo.length === 0) return false;
  return todo.every((task) => doneIds.has(task.id));
}

/* ---------- 打卡 ---------- */

/**
 * 进度存成 `{ done: [任务id], total: 当天应做任务数 }`。
 * 带上 total 是为了让周视图能画出"完成了多少"的填充比例，
 * 而不只是"完成 / 未完成"两态。
 */
export async function loadProgressRecord(kv, username, dateKey) {
  const stored = await getJson(kv, progressKey(username, dateKey));
  // 兼容早期只存数组的格式
  const done = Array.isArray(stored) ? stored : (stored?.done ?? []);
  return {
    done: new Set(Array.isArray(done) ? done : []),
    total: Array.isArray(stored) ? null : (stored?.total ?? null),
  };
}

export async function loadProgress(kv, username, dateKey) {
  return (await loadProgressRecord(kv, username, dateKey)).done;
}

async function saveProgress(kv, username, dateKey, doneIds, total) {
  await putJson(kv, progressKey(username, dateKey), { done: [...doneIds], total });
}

/**
 * 根据当前进度同步当天那条"已完成"记录。
 * 完成任务时写入 rec_ key，取消勾选导致不再全部完成时删掉它。
 */
async function syncDayRecord(kv, username, dateString, dateKey, tasks, doneIds) {
  const complete = isDayComplete(tasks, dateString, doneIds);
  const key = recordKey(username, dateKey);
  if (complete) {
    await putJson(kv, key, { completedAt: new Date().toISOString() });
  } else {
    await kv.delete(key);
  }
  return complete;
}

/**
 * 切换某个任务今天的完成状态。
 * 注意：这个函数**只操作今天**，日期由服务端算出来，请求里没有日期参数 ——
 * "严格不允许补卡"这条规则是这样在结构上保证的，而不是靠校验。
 */
export async function toggleTask(kv, username, taskId, done) {
  const dateString = beijingDateString();
  const dateKey = beijingDateKey();
  const tasks = await loadTasks(kv, username);

  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new ApiError('任务不存在', 404);
  if (task.archived) throw new ApiError('该任务已归档');

  const doneIds = await loadProgress(kv, username, dateKey);
  if (done) doneIds.add(taskId);
  else doneIds.delete(taskId);

  // 一次性任务被打勾时记录完成日期，之后就不再出现在待办里
  if (task.type === 'once') {
    const completedAt = done ? dateString : null;
    if (task.completedAt !== completedAt) {
      task.completedAt = completedAt;
      await saveTasks(kv, username, tasks);
    }
  }

  await saveProgress(kv, username, dateKey, doneIds, todoTasksFor(tasks, dateString).length);
  const complete = await syncDayRecord(kv, username, dateString, dateKey, tasks, doneIds);

  return { taskId, done, complete };
}

/** 任务的增删改之后要重新判定今天算不算完成 */
export async function resyncToday(kv, username) {
  const dateString = beijingDateString();
  const dateKey = beijingDateKey();
  const tasks = await loadTasks(kv, username);
  const doneIds = await loadProgress(kv, username, dateKey);
  return syncDayRecord(kv, username, dateString, dateKey, tasks, doneIds);
}

/* ---------- 统计与周视图 ---------- */

/** 取出所有已完成打卡的日期（'YYYY-MM-DD'） */
export async function loadCompletedDates(kv, username) {
  const keys = await listKeys(kv, `rec_${username}_`);
  return keys
    .map((key) => dateKeyFromRecordKey(key, username))
    .filter(Boolean)
    .map((dateKey) => `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`);
}

/** 一次请求返回前端首屏需要的全部打卡数据 */
export async function loadCheckinOverview(kv, username, weekDateStrings) {
  const dateString = beijingDateString();
  const dateKey = beijingDateKey();

  const [tasks, doneIds, completedDates] = await Promise.all([
    loadTasks(kv, username),
    loadProgress(kv, username, dateKey),
    loadCompletedDates(kv, username),
  ]);

  const completed = new Set(completedDates);

  const week = await Promise.all(
    weekDateStrings.map(async (day) => {
      const key = day.replace(/-/g, '');
      // 已完成的日子直接由 rec_ key 判定；否则看一下有没有部分进度
      const isComplete = completed.has(day);
      const progress = await loadProgressRecord(kv, username, key);
      return {
        date: day,
        isToday: day === dateString,
        isFuture: day > dateString,
        complete: isComplete,
        partial: !isComplete && progress.done.size > 0,
        doneCount: progress.done.size,
        totalCount: progress.total,
      };
    }),
  );

  const todo = todoTasksFor(tasks, dateString);
  const doneToday = todo.filter((task) => doneIds.has(task.id));

  return {
    today: {
      date: dateString,
      complete: completed.has(dateString),
      doneCount: doneToday.length,
      todoCount: todo.length,
      doneTaskIds: [...doneIds],
    },
    week,
    stats: {
      ...computeStreaks(completedDates, dateString),
      weekCompleted: week.filter((day) => day.complete && !day.isFuture).length,
    },
  };
}
