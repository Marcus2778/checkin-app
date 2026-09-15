export type TaskType = 'daily' | 'once'

export interface Task {
  id: string
  /** 任务就是一行字，如「跑步 800 米」 */
  title: string
  type: TaskType
  archived: boolean
  /** 一次性任务完成的那一天（'YYYY-MM-DD'），每日任务恒为 null */
  completedAt: string | null
  createdAt: string
}

export interface WeekDay {
  date: string
  isToday: boolean
  isFuture: boolean
  complete: boolean
  partial: boolean
  doneCount: number
  /** 当天应做的任务总数；早期没有记录时为 null */
  totalCount: number | null
}

export interface CheckinOverview {
  today: {
    date: string
    complete: boolean
    doneCount: number
    todoCount: number
    doneTaskIds: string[]
  }
  week: WeekDay[]
  stats: {
    current: number
    longest: number
    total: number
    weekCompleted: number
  }
}

export interface Session {
  username: string
  token: string
}

export interface TaskInput {
  title: string
  type: TaskType
}
