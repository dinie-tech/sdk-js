import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // CI must pass before any test files exist (scaffold story).
    passWithNoTests: true,
  },
});
