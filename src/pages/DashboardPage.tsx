import { api } from '../api'
import { StreakLine } from '../components/StreakLine'
import { TaskList } from '../components/TaskList'
import { WeekStamps } from '../components/WeekStamps'
import { formatDayMonth, formatWeekday } from '../format'
import { useAppData } from '../hooks/useAppData'
import type { Session } from '../types'

export function DashboardPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const data = useAppData(onLogout)

  if (data.loading) {
    return <div className="mx-auto max-w-[26rem] px-6 pt-20 text-sm text-muted">加载中…</div>
  }

  const { stats, week, today } = data

  return (
    <div className="mx-auto w-full max-w-[26rem] px-6 pb-24 pt-7">
      <header className="flex items-center justify-between text-[11px] text-muted/70">
        <span className="truncate">{session.username}</span>
        <button
          type="button"
          onClick={() => {
            void api.logout().catch(() => {})
            onLogout()
          }}
          className="rounded transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          退出
        </button>
      </header>

      {/* 日期。整页唯一的大字号，其余全部压小，靠对比而不是靠装饰分出主次。 */}
      <div className="mt-12">
        <h1 className="text-[1.75rem] leading-none font-medium tracking-tight text-ink">
          {today ? formatDayMonth(today) : ' '}
        </h1>
        <p className="mt-1.5 text-xs text-muted">{today ? formatWeekday(today) : ''}</p>
      </div>

      <div className="mt-9">
        <WeekStamps week={week} />
      </div>

      {stats && (
        <div className="mt-8">
          <StreakLine current={stats.current} longest={stats.longest} />
        </div>
      )}

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[0.95rem] font-medium text-ink">今天要做</h2>
          <span className="text-xs">
            {data.todayComplete ? (
              <span className="text-seal">已盖章</span>
            ) : (
              <span className="text-muted/70">
                {data.doneToday} / {data.todoTasks.length}
              </span>
            )}
          </span>
        </div>

        <div className="mt-2">
          <TaskList
            tasks={data.todoTasks}
            doneIds={data.doneIds}
            onToggle={data.actions.toggle}
            onCreate={data.actions.createTask}
            onUpdate={data.actions.updateTask}
            onDelete={data.actions.deleteTask}
          />
        </div>
      </section>

      {data.error && (
        <div className="mt-8 flex items-start justify-between gap-3">
          <p className="text-xs text-seal">{data.error}</p>
          <button
            type="button"
            onClick={data.clearError}
            className="shrink-0 text-xs text-muted/70 hover:text-ink"
          >
            知道了
          </button>
        </div>
      )}
    </div>
  )
}
