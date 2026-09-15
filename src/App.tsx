import { useCallback, useState } from 'react'
import { loadSession, saveSession } from './api'
import { StampDefs } from './components/StampDefs'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import type { Session } from './types'

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())

  const handleLogin = useCallback((next: Session) => {
    saveSession(next)
    setSession(next)
  }, [])

  // 退出登录，以及 token 失效时被 useAppData 回退到这里
  const handleLogout = useCallback(() => {
    saveSession(null)
    setSession(null)
  }, [])

  return (
    <div className="min-h-screen bg-paper">
      {/* 印章滤镜只在这里挂一次 */}
      <StampDefs />
      {session ? (
        <DashboardPage session={session} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </div>
  )
}
