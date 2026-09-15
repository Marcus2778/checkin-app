import type { WeekDay } from '../types'
import { Stamp, type StampState } from './Stamp'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function stateOf(day: WeekDay): StampState {
  if (day.complete) return 'done'
  if (day.partial) return 'partial'
  if (day.isToday) return 'waiting'
  return 'blank'
}

function ratioOf(day: WeekDay): number {
  if (day.complete) return 1
  if (!day.totalCount || day.totalCount <= 0) return 0
  return day.doneCount / day.totalCount
}

/**
 * 一周七天的印记。
 *
 * 这里没有"格子"：没盖过的日子就是真的空着，不画底、不描边。
 * 于是漏掉的一天在印章之间表现出来就是一个空缺 —— 连续与否一眼可见，
 * 不需要图例。今天若是还没盖，会留一个很淡的印子告诉你章该盖在哪。
 */
export function WeekStamps({ week }: { week: WeekDay[] }) {
  if (week.length === 0) return null

  return (
    <div>
      <div className="flex gap-2">
        {week.map((day) => {
          const state = stateOf(day)
          return (
            <div key={day.date} className="flex-1">
              {/* 用状态做 key：只有状态真的变了才重新挂载，盖章那一下的动效才不会被重复触发 */}
              <Stamp
                key={`${day.date}-${state}`}
                state={state}
                ratio={ratioOf(day)}
                seed={day.date}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {week.map((day, index) => (
          <span
            key={day.date}
            className={[
              'flex-1 text-center text-xs',
              day.isToday ? 'text-ink' : 'text-muted/60',
            ].join(' ')}
          >
            {WEEKDAY_LABELS[index]}
          </span>
        ))}
      </div>
    </div>
  )
}
