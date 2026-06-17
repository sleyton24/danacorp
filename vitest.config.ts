import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // forks falla en Windows con la ruta que tiene espacios ("Timeout waiting for
    // worker to respond"); threads es estable aquí.
    pool: 'threads',
    fileParallelism: false,
  },
});
