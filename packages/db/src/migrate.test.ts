import { describe, expect, it } from 'vitest';
import { diffMigrations, listMigrationFiles, parseArgv } from './migrate';

describe('diffMigrations', () => {
  it('раскладывает файлы и журнал на три непересекающихся множества', () => {
    const st = diffMigrations(['0000_a.sql', '0001_b.sql', '0002_c.sql'], ['0000_a.sql', '0009_gone.sql']);
    expect(st.applied).toEqual(['0000_a.sql']);
    expect(st.pending).toEqual(['0001_b.sql', '0002_c.sql']);
    expect(st.missing).toEqual(['0009_gone.sql']);
  });

  it('пустой журнал: всё pending', () => {
    const st = diffMigrations(['0000_a.sql', '0001_b.sql'], []);
    expect(st.applied).toEqual([]);
    expect(st.pending).toEqual(['0000_a.sql', '0001_b.sql']);
    expect(st.missing).toEqual([]);
  });

  it('база в актуальном состоянии: pending пуст', () => {
    const st = diffMigrations(['0000_a.sql'], ['0000_a.sql']);
    expect(st.pending).toEqual([]);
    expect(st.missing).toEqual([]);
  });

  it('сохраняет лексикографический порядок файлов, а не порядок журнала', () => {
    const st = diffMigrations(['0000_a.sql', '0001_b.sql'], ['0001_b.sql', '0000_a.sql']);
    expect(st.applied).toEqual(['0000_a.sql', '0001_b.sql']);
  });

  it('applied и pending в сумме дают все файлы', () => {
    const files = ['0000_a.sql', '0001_b.sql', '0002_c.sql'];
    const st = diffMigrations(files, ['0001_b.sql']);
    expect([...st.applied, ...st.pending].sort()).toEqual(files);
  });
});

describe('формат JSON для deploy-zak', () => {
  it('однострочный, поле pending вычленяется грепом', () => {
    const st = diffMigrations(['a.sql', 'b.sql'], ['a.sql']);
    const line = JSON.stringify({ ok: true, ...st });
    expect(line).not.toContain('\n');
    expect(line.match(/"pending":\[[^\]]*\]/)?.[0]).toBe('"pending":["b.sql"]');
  });

  it('пустой pending сравним со строкой-маркером', () => {
    const line = JSON.stringify({ ok: true, ...diffMigrations(['a.sql'], ['a.sql']) });
    expect(line).toContain('"pending":[]');
  });
});

describe('parseArgv', () => {
  it('без аргументов — режим наката (обратная совместимость)', () => {
    expect(parseArgv([])).toEqual({ mode: 'apply', json: false });
  });

  it('status и check', () => {
    expect(parseArgv(['status'])).toEqual({ mode: 'status', json: false });
    expect(parseArgv(['status', '--json'])).toEqual({ mode: 'status', json: true });
    expect(parseArgv(['check'])).toEqual({ mode: 'check', json: false });
  });

  it('отбрасывает разделитель `--`, который протаскивает pnpm run', () => {
    expect(parseArgv(['--', 'status', '--json'])).toEqual({ mode: 'status', json: true });
  });

  it('падает на неизвестной команде и неизвестном флаге', () => {
    expect(() => parseArgv(['bogus'])).toThrow(/Неизвестная команда/);
    expect(() => parseArgv(['--bogus'])).toThrow(/Неизвестный флаг/);
    expect(() => parseArgv(['status', 'extra'])).toThrow(/Лишние аргументы/);
  });
});

describe('listMigrationFiles', () => {
  it('возвращает только .sql в лексикографическом порядке', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith('.sql'))).toBe(true);
    expect([...files].sort()).toEqual(files);
  });
});
