import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api'
import type { CheckinOverview, Task, TaskInput } from '../types'

/**
 * 任务列表 + 打卡状态 + 统计，以及所有写操作。
 *
 * 勾选用了乐观更新：本地先亮起来，等服务器返回再以服务器为准。
 * 部署到边缘节点后一个往返可能要几百毫秒，"盖章"那一下必须是即时的。
 */
export function useAppData(onUnauthorized: () => void) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [overview, setOverview] = useState<CheckinOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized()
        return
      }
      setError(err instanceof Error ? err.message : '出错了，请重试')
    },
    [onUnauthorized],
  )

  const refresh = useCallback(async () => {
    try {
      const [taskResult, overviewResult] = await Promise.all([api.listTasks(), api.getCheckins()])
      setTasks(taskResult.tasks)
      setOverview(overviewResult)
      setError(null)
    } catch (err) {
      handleError(err)
    } finally {
      setLoading(false)
    }
  }, [handleError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = useCallback(
    async (taskId: string, done: boolean) => {
      setOptimistic((prev) => ({ ...prev, [taskId]: done }))
      try {
        const next = await api.toggleCheckin(taskId, done)
        setOverview(next)
        // 一次性任务打勾后要立刻从待办里消失，这里同步一下本地任务
        setTasks((prev) =>
          prev.map((task) =>
            task.id === taskId && task.type === 'once'
              ? { ...task, completedAt: done ? next.today.date : null }
              : task,
          ),
        )
      } catch (err) {
        handleError(err)
      } finally {
        setOptimistic((prev) => {
          const next = { ...prev }
          delete next[taskId]
          return next
        })
      }
    },
    [handleError],
  )

  /** 任务增删改之后统一重新拉一遍，避免本地和服务端算出来的"今天是否完成"不一致 */
  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action()
        await refresh()
      } catch (err) {
        handleError(err)
        throw err
      }
    },
    [handleError, refresh],
  )

  const createTask = useCallback(
    (input: TaskInput) => mutate(() => api.createTask(input)),
    [mutate],
  )

  const updateTask = useCallback(
    (id: string, patch: Partial<TaskInput> & { archived?: boolean }) =>
      mutate(() => api.updateTask(id, patch)),
    [mutate],
  )

  const deleteTask = useCallback((id: string) => mutate(() => api.deleteTask(id)), [mutate])

  // 当前有效的任务（归档的不算）
  const activeTasks = useMemo(
    () => tasks.filter((task) => !task.archived),
    [tasks],
  )

  // 今天应做的任务。逻辑和 后端 todoTasksFor 保持一致。
  const todoTasks = useMemo(() => {
    const today = overview?.today.date
    if (!today) return activeTasks
    return activeTasks.filter((task) => {
      if (task.type !== 'once') return true
      if (!task.completedAt) return true
      return task.completedAt === today
    })
  }, [activeTasks, overview])

  // 服务器数据叠加本地乐观状态
  const doneIds = useMemo(() => {
    const set = new Set(overview?.today.doneTaskIds ?? [])
    for (const [id, value] of Object.entries(optimistic)) {
      if (value) set.add(id)
      else set.delete(id)
    }
    return set
  }, [overview, optimistic])

  const doneToday = useMemo(
    () => todoTasks.filter((task) => doneIds.has(task.id)).length,
    [todoTasks, doneIds],
  )

  const todayComplete = todoTasks.length > 0 && doneToday === todoTasks.length

  // 本周热力图：今天那一格要用本地状态覆盖，这样盖章是即时的
  const week = useMemo(() => {
    if (!overview) return []
    return overview.week.map((day) =>
      day.isToday
        ? {
            ...day,
            complete: todayComplete,
            partial: !todayComplete && doneToday > 0,
            doneCount: doneToday,
            totalCount: todoTasks.length,
          }
        : day,
    )
  }, [overview, todayComplete, doneToday, todoTasks])

  return {
    loading,
    error,
    clearError: () => setError(null),
    todoTasks,
    activeTasks,
    doneIds,
    doneToday,
    todayComplete,
    week,
    today: overview?.today.date ?? null,
    stats: overview?.stats ?? null,
    actions: { toggle, createTask, updateTask, deleteTask, refresh },
  }
}
