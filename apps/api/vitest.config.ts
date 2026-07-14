import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/dbUrl';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Тестовая БД одна на всех — файлы не должны топтаться друг по другу.
    fileParallelism: false,
    // Переменные задаются ЯВНО и до загрузки src/config/env.ts. Тот подтягивает
    // корневой .env, который смотрит на прод: dotenv не перетирает уже
    // выставленные значения, поэтому тесты гарантированно остаются на тестовой БД.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      // Локальная БД без TLS: иначе подхватился бы CA из .env (для Yandex PG).
      DATABASE_SSL_CA: '',
      JWT_ACCESS_SECRET: 'test-access-secret-must-be-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-must-be-long',
      PUBLIC_WEB_URL: 'https://zak.test.local',
      WEB_ORIGIN: 'https://zak.test.local',
      STORAGE_ROOT: '.local/test-storage',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
