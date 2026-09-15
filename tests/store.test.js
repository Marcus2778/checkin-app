import { describe, expect, it } from 'vitest';
import { isDayComplete, todoTasksFor } from '../backend/_lib/store.mjs';

const TODAY = '2026-09-15';
const YESTERDAY = '2026-09-14';

const daily = (id, extra = {}) => ({ id, title: id, type: 'daily', archived: false, ...extra });
const once = (id, extra = {}) => ({ id, title: id, type: 'once', archived: false, ...extra });

describe('todoTasksFor', () => {
  it('每日任务每天都要做', () => {
    expect(todoTasksFor([daily('a')], TODAY).map((t) => t.id)).toEqual(['a']);
  });

  it('未完成的一次性任务要做', () => {
    expect(todoTasksFor([once('a')], TODAY).map((t) => t.id)).toEqual(['a']);
  });

  it('昨天完成的一次性任务不再出现', () => {
    expect(todoTasksFor([once('a', { completedAt: YESTERDAY })], TODAY)).toEqual([]);
  });

  // 边界：如果只有这一个一次性任务，今天勾完它必须仍然算数，
  // 否则这个用户永远无法完成打卡。
  it('今天刚完成的一次性任务，今天仍然算数', () => {
    expect(todoTasksFor([once('a', { completedAt: TODAY })], TODAY).map((t) => t.id)).toEqual(['a']);
  });

  it('归档的任务不算，无论哪种类型', () => {
    expect(todoTasksFor([daily('a', { archived: true }), once('b', { archived: true })], TODAY))
      .toEqual([]);
  });
});

describe('isDayComplete', () => {
  it('一个任务都没有时不算完成（没东西可打）', () => {
    expect(isDayComplete([], TODAY, new Set())).toBe(false);
  });

  it('所有每日任务都勾了才算完成', () => {
    const tasks = [daily('a'), daily('b')];
    expect(isDayComplete(tasks, TODAY, new Set(['a', 'b']))).toBe(true);
  });

  it('只勾了一部分不算完成', () => {
    const tasks = [daily('a'), daily('b')];
    expect(isDayComplete(tasks, TODAY, new Set(['a']))).toBe(false);
  });

  it('没有勾任何任务不算完成', () => {
    expect(isDayComplete([daily('a')], TODAY, new Set())).toBe(false);
  });

  it('唯一的一次性任务今天勾了，就算完成', () => {
    const tasks = [once('a', { completedAt: TODAY })];
    expect(isDayComplete(tasks, TODAY, new Set(['a']))).toBe(true);
  });

  it('一次性任务已完成于昨天，今天只需做完每日任务', () => {
    const tasks = [daily('a'), once('b', { completedAt: YESTERDAY })];
    expect(isDayComplete(tasks, TODAY, new Set(['a']))).toBe(true);
  });

  it('已完成的一次性任务不会因为没勾而挡住当天完成', () => {
    const tasks = [once('b', { completedAt: YESTERDAY })];
    // 今天没有任何应做任务 -> 不算完成，而不是算完成
    expect(isDayComplete(tasks, TODAY, new Set())).toBe(false);
  });

  it('归档任务不参与判定', () => {
    const tasks = [daily('a'), daily('b', { archived: true })];
    expect(isDayComplete(tasks, TODAY, new Set(['a']))).toBe(true);
  });
});
