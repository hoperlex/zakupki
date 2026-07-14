// Единая точка выбора тестовой БД. Импортируется и vitest.config.ts, и
// globalSetup — конфиг не должен зависеть от src/config/env.ts.
//
// Тесты дропают и пересоздают схему, поэтому промах адресом = потеря данных.
// Корневой .env этого репозитория смотрит на ПРОД (Yandex Managed PG), так что
// молчаливый фолбэк на DATABASE_URL здесь недопустим ни при каких условиях.

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://zakupki:zakupki@127.0.0.1:5432/zakupki_test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Пропускает только заведомо тестовый адрес. Любое сомнение — отказ:
 * упавший прогон дешевле снесённой базы.
 */
export function assertSafeTestDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL не разбирается как URL: ${url}`);
  }

  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Тесты пересоздают схему и запускаются только против локальной БД. Хост '${parsed.hostname}' локальным не является.`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Имя тестовой БД обязано оканчиваться на '_test', получено '${dbName}'.`);
  }

  // Прямая защита от промаха: тестовый адрес не должен совпадать с рабочим.
  const configured = process.env.DATABASE_URL;
  if (configured && configured === url) {
    throw new Error('TEST_DATABASE_URL совпадает с DATABASE_URL — тесты снесли бы рабочую базу.');
  }
}
