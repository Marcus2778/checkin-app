import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { mockApi } from './dev/mock-api-plugin.js'

/**
 * 本地开发配置：前端 + 内存版后端，不需要 EdgeOne 账号就能把整个应用跑起来。
 * 部署用的是 vite.config.ts，两者互不影响。
 *
 *   npm run dev:mock
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), mockApi()],
})
