import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Testes unitários do apps/web (#351) — lógica pura (nav-config,
 * permission-match), sem DOM. Componentes/hooks React ficam de fora até
 * precisarmos de jsdom + testing-library.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
