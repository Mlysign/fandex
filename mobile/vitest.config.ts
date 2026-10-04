import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Tests here cover the app's logic that needs no device: date arithmetic, the
// catalog sync's cursor handling. Anything that renders is checked in a
// browser or on a phone, not here.
export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(here, 'src'),
      '@': path.resolve(here, '../src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
