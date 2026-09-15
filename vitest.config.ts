import { defineConfig } from 'vitest/config';

// 单独一份配置，避免和 vite.config.ts 里的前端构建插件混在一起。
// 目前只用来跑 backend/_lib 下的纯函数。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
