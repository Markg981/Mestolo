import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts', 'src/types/**'],
      thresholds: {
        statements: 42,
        branches: 38,
        functions: 31,
        lines: 42,
        'src/app/actions/**': { statements: 42, branches: 35, functions: 37, lines: 46 },
        'src/lib/data/**': { statements: 29, branches: 25, functions: 28, lines: 30 },
      },
      reporter: ['text-summary', 'lcov'],
    },
  },
});
