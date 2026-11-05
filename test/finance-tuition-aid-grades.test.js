import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleTuitionAidApi, tapShiftGrade } from '../apps/finance/accounting/tuition-aid.js';
import { TUITION_FINANCE_SCHEMA } from '../apps/finance/accounting/tuition-storage.js';

// A student's base_grade is their grade in the current school year, so changing that year moves
// every entered grade with it; and a single student's grade can be corrected on its own.

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of TUITION_FINANCE_SCHEMA) sqlite.exec(sql);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) { for (const item of statements) await item.run(); return []; },
  };
}

function seed(db) {
  db.sqlite.exec(`
    INSERT INTO tuition_config (key, value) VALUES ('base_school_year', '2026');
    INSERT INTO tuition_students (id, family, child, is_pipeline, base_grade, birth_year, active) VALUES
      (1, 'Able', 'Ann', 0, '3', NULL, 1),
      (2, 'Baker', 'Bo', 0, '8', NULL, 1),
      (3, 'Cole', 'Cy', 0, '12', NULL, 1),
      (4, 'Dale', 'Di', 1, '', 2023, 1),
      (5, 'Eto', 'Ed', 1, 'PK 4', 2022, 1),
      (6, 'Fox', 'Fay', 0, '5', NULL, 0);
  `);
}

const call = (db, method, seg, body) => handleTuitionAidApi(
  new Request('https://finance.test/api', { method, body: body ? JSON.stringify(body) : undefined }),
  {}, new URL('https://finance.test/api'), method, seg, db, true, null,
);
const grades = (db) => Object.fromEntries(db.sqlite.prepare('SELECT id, base_grade FROM tuition_students ORDER BY id').all().map((r) => [r.id, r.base_grade]));

describe('tapShiftGrade', () => {
  it('moves along the grade ladder and stops at either end', () => {
    expect(tapShiftGrade('PK 4', 1)).toBe('K');
    expect(tapShiftGrade('K', 1)).toBe('1');
    expect(tapShiftGrade('8', 1)).toBe('9');
    expect(tapShiftGrade('12', 1)).toBe('Graduated');
    expect(tapShiftGrade('Graduated', 1)).toBe('Graduated');
    expect(tapShiftGrade('Graduated', -1)).toBe('12');
    expect(tapShiftGrade('3', 2)).toBe('5');
    expect(tapShiftGrade('K', -3)).toBe('PK 3');
    expect(tapShiftGrade('odd', 1)).toBe('odd');
  });
});

describe('Tuition Aid: current school year and grades', () => {
  it('moves every active student with an entered grade up when the year advances', async () => {
    const db = fakeD1(); seed(db);
    const res = await call(db, 'PATCH', 'tuition-aid/config', { values: { base_school_year: 2027 } });
    expect(await res.json()).toEqual({ ok: true, grades_moved: 4 });
    expect(grades(db)).toEqual({ 1: '4', 2: '9', 3: 'Graduated', 4: '', 5: 'K', 6: '5' });
    expect(db.sqlite.prepare(`SELECT value FROM tuition_config WHERE key='base_school_year'`).get().value).toBe('2027');
  });

  it('moves them back when the year is set back, and leaves grades alone when the year is unchanged', async () => {
    const db = fakeD1(); seed(db);
    await call(db, 'PATCH', 'tuition-aid/config', { values: { base_school_year: 2027 } });
    await call(db, 'PATCH', 'tuition-aid/config', { values: { base_school_year: '2026' } });
    expect(grades(db)).toEqual({ 1: '3', 2: '8', 3: '12', 4: '', 5: 'PK 4', 6: '5' });
    const res = await call(db, 'PATCH', 'tuition-aid/config', { values: { base_school_year: 2026, tuition_growth_pct: 5 } });
    expect((await res.json()).grades_moved).toBe(0);
    expect(grades(db)[1]).toBe('3');
  });

  it('leaves grades alone when another setting changes', async () => {
    const db = fakeD1(); seed(db);
    await call(db, 'PATCH', 'tuition-aid/config', { values: { tuition_growth_pct: 5 } });
    expect(grades(db)[1]).toBe('3');
  });

  it('changes one student’s grade on its own', async () => {
    const db = fakeD1(); seed(db);
    const res = await call(db, 'PATCH', 'tuition-aid/students/1', { base_grade: '4' });
    expect(res.status).toBe(200);
    expect(grades(db)).toMatchObject({ 1: '4', 2: '8' });
  });
});
