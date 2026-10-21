import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.{ts,tsx}'],
    env: { NODE_ENV: 'test' },
    fileParallelism: false, // tests share one dev database
  },
});
