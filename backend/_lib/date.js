/**
 * 北京时间日期工具。
 *
 * 为什么需要这个文件：EdgeOne 的边缘函数运行在世界各地的节点上，
 * 函数里 `new Date()` 拿到的是 UTC 时间。如果不做转换，晚上 8 点之后
 * 打卡会被算成"第二天"，周末前后的连续打卡统计也会错。
 * 所以所有"今天是几号"的判断都必须经过这里。
 *
 * 约定：对外一律用 'YYYY-MM-DD' 字符串表示日期，KV 的 key 里用 'YYYYMMDD'。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把任意时刻转成北京时间的 'YYYY-MM-DD' */
export function beijingDateString(date = new Date()) {
  return new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 把任意时刻转成北京时间的 'YYYYMMDD'，用于拼 KV key */
export function beijingDateKey(date = new Date()) {
  return beijingDateString(date).replace(/-/g, '');
}

/** 把 'YYYY-MM-DD' 或 'YYYYMMDD' 解析成 UTC 午夜的 Date，便于做天数加减 */
export function parseDateString(value) {
  const iso =
    value.length === 8
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Date -> 'YYYY-MM-DD' */
export function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** 日期字符串加减天数，返回 'YYYY-MM-DD' */
export function addDays(dateString, days) {
  const date = parseDateString(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

/** 星期几，1 = 周一 … 7 = 周日（中国人习惯的排法） */
export function weekday(dateString) {
  const day = parseDateString(dateString).getUTCDay(); // 0 = 周日
  return day === 0 ? 7 : day;
}

/** 给定日期所在那一周（周一起始）的 7 个日期 */
export function weekDates(dateString) {
  const monday = addDays(dateString, -(weekday(dateString) - 1));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}
