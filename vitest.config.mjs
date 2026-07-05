import { defineConfig } from 'vitest/config';

// Unit tests for the pure renderer logic (Phase 2 of the June-2026 review).
// The renderer modules are ES modules that reference window/document at call
// time; test/setup.js stubs those globals so a module graph that reaches into
// render/DOM code can still be imported and its pure functions exercised in a
// plain Node environment. The hand-rolled scripts/smoke-*.js still run the
// bigger integration flows (and the DB round-trips under Electron).
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
  },
});
