import { describe, expect, it } from 'vitest';
import {
  addDays,
  beijingDateKey,
  beijingDateString,
  parseDateString,
  weekDates,
  weekday,
} from '../backend/_lib/date.js';

describe('beijingDateString', () => {
  it('UTC 当天白天，还是北京时间当天', () => {
    expect(beijingDateString(new Date('2026-09-15T00:00:00Z'))).toBe('2026-09-15');
  });

  // 这是整个模块存在的理由：UTC 还是 14 号，北京时间已经是 15 号了。
  // 如果用 UTC 判断，晚上 8 点之后打的卡会被记到隔天。
  it('UTC 晚间跨到北京时间次日', () => {
    expect(beijingDateString(new Date('2026-09-14T20:00:00Z'))).toBe('2026-09-15');
  });

  it('北京时间 23:59 仍是当天', () => {
    expect(beijingDateString(new Date('2026-09-14T15:59:00Z'))).toBe('2026-09-14');
  });

  it('北京时间 00:00 整点跳到次日', () => {
    expect(beijingDateString(new Date('2026-09-14T16:00:00Z'))).toBe('2026-09-15');
  });
});

describe('beijingDateKey', () => {
  it('产出 KV key 用的 YYYYMMDD（不含短横线）', () => {
    expect(beijingDateKey(new Date('2026-09-15T00:00:00Z'))).toBe('20260915');
  });
});

describe('weekday', () => {
  it('周一 = 1', () => {
    expect(weekday('2026-09-14')).toBe(1);
  });

  it('周日 = 7（而不是 0）', () => {
    expect(weekday('2026-09-20')).toBe(7);
  });

  it('周四 = 4', () => {
    expect(weekday('2026-09-17')).toBe(4);
  });
});

describe('addDays', () => {
  it('跨月', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('往回退跨年', () => {
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('闰年 2 月 28 日 + 1 天', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('平年 2 月 28 日 + 1 天', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});

describe('weekDates', () => {
  it('周四所在的那一周从周一排到周日', () => {
    expect(weekDates('2026-09-17')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('周一自己所在的那一周就是它开头', () => {
    expect(weekDates('2026-09-14')[0]).toBe('2026-09-14');
  });

  it('周日属于当周而不是下一周', () => {
    expect(weekDates('2026-09-20')).toEqual(weekDates('2026-09-14'));
  });
});

describe('parseDateString', () => {
  it('接受 YYYYMMDD 紧凑格式', () => {
    expect(parseDateString('20260915').toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('接受 YYYY-MM-DD 格式', () => {
    expect(parseDateString('2026-09-15').toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });
});
