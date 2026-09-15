const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** '2026-09-15' -> '9月15日 星期一' */
export function formatChineseDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 星期${WEEKDAY_CN[date.getUTCDay()]}`
}

/** '2026-09-15' -> '9月15日' */
export function formatDayMonth(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

/** '2026-09-15' -> '星期一' */
export function formatWeekday(isoDate: string): string {
  return `星期${WEEKDAY_CN[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]}`
}

/** '2026-09-15' -> '9/15'，用于周视图的日期注脚 */
export function formatShortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}
