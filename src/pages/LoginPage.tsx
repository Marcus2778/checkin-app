import { useState } from 'react'
import { api } from '../api'
import type { Session } from '../types'

/** 三枚小章：两枚盖过，一枚还空着。就是上面那排印章的缩影。 */
function Mark() {
  return (
    <span className="flex gap-[3px]" aria-hidden="true" style={{ filter: 'url(#stamp-ink-small)' }}>
      <span className="block size-3 rounded-[3px] bg-seal" style={{ opacity: 0.95 }} />
      <span className="block size-3 rounded-[3px] bg-seal" style={{ opacity: 0.87 }} />
      <span className="block size-3 rounded-[3px] border-2 border-slot" />
    </span>
  )
}

const fieldClass =
  'w-full border-b-2 border-line bg-transparent py-2 text-[0.95rem] text-ink transition-colors outline-none placeholder:text-muted/50 focus:border-ink focus-visible:ring-0'

export function LoginPage({ onLogin }: { onLogin: (session: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRegister = mode === 'register'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = isRegister
        ? await api.register(username.trim(), password)
        : await api.login(username.trim(), password)
      onLogin({ username: result.username, token: result.token })
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了，请重试')
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(isRegister ? 'login' : 'register')
    setError(null)
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[22rem] flex-col justify-center px-6 pb-28">
      <div className="flex items-center gap-2.5">
        <Mark />
        <span className="text-sm font-medium text-ink">打卡</span>
      </div>

      <form onSubmit={submit} className="mt-11 space-y-6">
        <div>
          <label htmlFor="username" className="block text-[11px] text-muted/80">
            用户名
          </label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={isRegister ? '字母、数字或下划线' : ''}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-[11px] text-muted/80">
            密码
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            placeholder={isRegister ? '至少 6 位' : ''}
            className={fieldClass}
          />
        </div>

        {error && <p className="text-xs text-seal">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-[5px] bg-ink py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-none disabled:opacity-50"
        >
          {busy ? '请稍候…' : isRegister ? '注册' : '登录'}
        </button>
      </form>

      <button
        type="button"
        onClick={switchMode}
        className="mt-6 self-start rounded text-xs text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
      >
        {isRegister ? '已经有账号了，去登录' : '还没有账号，注册一个'}
      </button>
    </div>
  )
}
