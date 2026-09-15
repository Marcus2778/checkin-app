import type { CheckinOverview, Session, Task, TaskInput } from './types'

const TOKEN_KEY = 'checkin.session'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.token && parsed?.username ? parsed : null
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  if (session) localStorage.setItem(TOKEN_KEY, JSON.stringify(session))
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession()
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (init.body) headers['content-type'] = 'application/json'
  if (session?.token) headers.authorization = `Bearer ${session.token}`

  const response = await fetch(path, { ...init, headers })

  if (response.status === 204) return undefined as T

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // 后端出错时可能返回非 JSON，下面统一按状态码处理
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string })?.error ?? `请求失败（${response.status}）`
    throw new ApiError(message, response.status)
  }

  return payload as T
}

export const api = {
  register: (username: string, password: string) =>
    request<Session & { expiresAt: number }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<Session & { expiresAt: number }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listTasks: () => request<{ tasks: Task[] }>('/api/tasks'),

  createTask: (input: TaskInput) =>
    request<{ task: Task; complete: boolean }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTask: (id: string, patch: Partial<TaskInput> & { archived?: boolean }) =>
    request<{ task: Task; complete: boolean }>('/api/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id, ...patch }),
    }),

  deleteTask: (id: string) =>
    request<{ ok: true; complete: boolean }>('/api/tasks', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    }),

  getCheckins: () => request<CheckinOverview>('/api/checkins'),

  toggleCheckin: (taskId: string, done: boolean) =>
    request<CheckinOverview>('/api/checkins', {
      method: 'POST',
      body: JSON.stringify({ taskId, done }),
    }),
}
