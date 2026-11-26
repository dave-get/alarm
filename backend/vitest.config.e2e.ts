import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Password hashing (scrypt) is deliberately slow; sequential suite against a live stack.
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
