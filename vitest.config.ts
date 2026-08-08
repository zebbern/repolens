import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
    // Prefer Node.js-compatible builds for packages like fflate whose browser builds
    // use Web Workers that don't function in jsdom.
    conditions: ['node'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'threads',
    maxWorkers: 4,
    setupFiles: ['./test/setup.ts'],
    server: {
      deps: {
        // Inline fflate so Vite doesn't pre-bundle it (avoids breaking binary ops)
        inline: ['fflate'],
      },
    },
    include: [
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'components/**/*.test.{ts,tsx}',
      'hooks/**/*.test.ts',
      'providers/**/*.test.{ts,tsx}',
      'types/**/*.test.ts',
    ],
    exclude: ['node_modules', '.next', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: [
        'lib/**/*.ts',
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'hooks/**/*.ts',
        'providers/**/*.{ts,tsx}',
        'config/**/*.ts',
        'proxy.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/index.ts',
        '**/types.ts',
        'components/ui/**',
        'lib/utils.ts',
      ],
      thresholds: {
        statements: 35,
        branches: 20,
        functions: 20,
        lines: 35,
      },
    },
  },
});
