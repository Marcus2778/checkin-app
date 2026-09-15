/**
 * 连续打卡天数计算。
 *
 * 这是一个纯函数模块：不碰 KV、不碰网络，所以可以直接单元测试
 * （见 tests/streak.test.js）。业务里最容易算错的就是这块，
 * 把它隔离成纯函数是为了能穷举边界情况。
 */

import { addDays } from './date.mjs';

/**
 * @param {string[]} completedDates 已完成打卡的日期（'YYYY-MM-DD'），顺序和重复都无所谓
 * @param {string} today 北京时间今天（'YYYY-MM-DD'）
 * @returns {{ current: number, longest: number, total: number }}
 */
export function computeStreaks(completedDates, today) {
  const days = new Set(completedDates);

  // 最长连续：排序后扫一遍，看每一段连续到多长
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const day of sorted) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  // 当前连续：从今天往回数。
  // 如果今天还没打卡，就从昨天开始数 —— 今天还没过完，不该算作"断了"。
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest, total: days.size };
}
