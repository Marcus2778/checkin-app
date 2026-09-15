import { useEffect, useRef, useState } from 'react'
import type { Task, TaskInput, TaskType } from '../types'

interface Props {
  tasks: Task[]
  doneIds: Set<string>
  onToggle: (taskId: string, done: boolean) => void
  onCreate: (input: TaskInput) => Promise<void>
  onUpdate: (id: string, patch: Partial<TaskInput>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function CheckMark() {
  return (
    <svg viewBox="0 0 14 14" className="size-3" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.5 5.5 10.5 11.5 3.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 勾选框也是一枚小印章。用 key 绑在 checked 上，
 * 这样只有真正切换的那一刻会重新挂载、播放一次压印动效。
 *
 * 焦点环放在 label 上而不是被滤镜处理的那个方块上 —— 否则
 * box-shadow 会被 feDisplacementMap 一起揉歪，焦点指示就不清晰了。
 */
function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  /** 读屏需要它，测试定位也需要它 */
  label: string
}) {
  return (
    <label className="mt-2 grid size-5 shrink-0 cursor-pointer place-items-center rounded-[4px] focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-2">
      <input
        type="checkbox"
        className="sr-only"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        key={checked ? 'on' : 'off'}
        aria-hidden="true"
        className={[
          'grid size-5 place-items-center rounded-[4px] border-2 transition-colors',
          checked
            ? 'border-seal bg-seal text-paper motion-safe:animate-[stamp-press_320ms_cubic-bezier(0.2,0.8,0.3,1)]'
            : 'border-line text-transparent',
        ].join(' ')}
        style={{ filter: 'url(#stamp-ink-small)' }}
      >
        <CheckMark />
      </span>
    </label>
  )
}

/** 行内编辑：新建和修改都用这一条，不弹窗 */
function TaskRowEditor({
  task,
  onCancel,
  onSave,
  onDelete,
}: {
  task: Task | null
  onCancel: () => void
  onSave: (input: TaskInput) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [type, setType] = useState<TaskType>(task?.type ?? 'daily')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = title.trim()
    if (!value) {
      setError('写点什么吧')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({ title: value, type })
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setBusy(false)
    }
  }

  async function remove() {
    if (!onDelete) return
    setBusy(true)
    try {
      await onDelete()
      onCancel()
    } catch {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="py-2.5">
      <input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
        maxLength={60}
        placeholder="跑步 800 米"
        className="w-full border-b-2 border-ink bg-transparent pb-1 text-[0.95rem] text-ink outline-none placeholder:text-muted/50"
      />

      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {(
          [
            ['daily', '每天'],
            ['once', '只做一次'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            aria-pressed={type === value}
            className={[
              'rounded px-1.5 py-0.5 transition-colors',
              type === value ? 'font-medium text-ink' : 'text-muted/70 hover:text-muted',
            ].join(' ')}
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="text-muted/70 transition-colors hover:text-seal disabled:opacity-50"
            >
              删除
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="font-medium text-ink transition-opacity hover:opacity-60 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-seal">{error}</p>}
    </form>
  )
}

export function TaskList({
  tasks,
  doneIds,
  onToggle,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  /** 正在编辑的任务 id，'new' 表示在新建 */
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  const creating = editing === 'new'

  return (
    <ul>
      {tasks.map((task) => {
        const done = doneIds.has(task.id)

        if (editing === task.id) {
          return (
            <li key={task.id} className="border-b border-line/70">
              <TaskRowEditor
                task={task}
                onCancel={() => setEditing(null)}
                onSave={(input) => onUpdate(task.id, input)}
                onDelete={() => onDelete(task.id)}
              />
            </li>
          )
        }

        return (
          <li key={task.id} className="flex items-center gap-3 border-b border-line/70">
            <Checkbox
              checked={done}
              onChange={(next) => onToggle(task.id, next)}
              label={task.title}
            />
            <button
              type="button"
              onClick={() => setEditing(task.id)}
              title="点击修改"
              className={[
                'flex-1 py-2.5 text-left text-[0.95rem] transition-opacity hover:opacity-60',
                done ? 'text-muted line-through' : 'text-ink',
              ].join(' ')}
            >
              {task.title}
            </button>
            {task.type === 'once' && (
              <span className="shrink-0 text-[10px] text-muted/60">一次性</span>
            )}
          </li>
        )
      })}

      {creating ? (
        <li>
          <TaskRowEditor
            task={null}
            onCancel={() => setEditing(null)}
            onSave={onCreate}
          />
        </li>
      ) : (
        <li>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="py-2.5 text-sm text-muted/70 transition-colors hover:text-ink"
          >
            ＋ 添加任务
          </button>
        </li>
      )}
    </ul>
  )
}
