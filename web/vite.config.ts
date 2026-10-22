/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
