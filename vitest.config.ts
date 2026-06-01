import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // CI must pass before any test files exist (scaffold story).
    passWithNoTests: true,
    // Don't discover tests inside agent worktrees: a checked-out worktree at
    // `.claude/worktrees/<name>/` mirrors this whole tree, so vitest (which walks the
    // filesystem, not git) would otherwise double-count every test when a worktree is
    // present. Keep vitest's built-in excludes (node_modules, dist, …) by spreading them.
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
});
