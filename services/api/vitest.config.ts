import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      QUEUE_INLINE: 'true',
      AUTH_DEV_BYPASS: 'true',
      SENDER_HMAC_KEY: 'test-key',
    },
  },
});
