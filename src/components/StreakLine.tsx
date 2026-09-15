/**
 * 连续天数。只有一个重点：当前连续 —— 它是这里唯一还活着、还会变的数字，
 * 所以给它排版上的分量，最长记录退成小字。
 * 本周完成多少天不在这里说 —— 上面那排印章已经把它画出来了。
 */
export function StreakLine({ current, longest }: { current: number; longest: number }) {
  return (
    <p className="flex items-baseline gap-5">
      <span className="text-sm text-muted">
        连续
        <span className="mx-1.5 align-baseline text-[1.6rem] font-semibold text-seal">
          {current}
        </span>
        天
      </span>
      <span className="text-xs text-muted/80">最长 {longest} 天</span>
    </p>
  )
}
