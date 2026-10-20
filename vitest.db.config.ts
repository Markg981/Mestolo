import { defineConfig } from 'vitest/config';

// Database / RLS tests. They need TEST_DATABASE_URL pointing to a database
// where supabase/tests/supabase-stub.sql and all migrations were applied.
// Run them with: npm run db:test:local
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
  },
});
