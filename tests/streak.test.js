import { describe, expect, it } from 'vitest';
import { computeStreaks } from '../backend/_lib/streak.mjs';

const TODAY = '2026-09-15';

/** 生成从 endDate 往回数 count 天的连续日期（含 endDate） */
function consecutive(endDate, count) {
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(`${endDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

describe('computeStreaks - 空与单点', () => {
  it('完全没有记录', () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, longest: 0, total: 0 });
  });

  it('只有今天，当前和最长都是 1', () => {
    expect(computeStreaks(['2026-09-15'], TODAY)).toEqual({ current: 1, longest: 1, total: 1 });
  });

  // 今天还没打卡不该算"断了" —— 一天还没过完。
  it('只有昨天，今天尚未打卡，当前连续仍然是 1', () => {
    expect(computeStreaks(['2026-09-14'], TODAY)).toEqual({ current: 1, longest: 1, total: 1 });
  });

  it('只有前天（昨天漏了），当前连续归零但最长是 1', () => {
    expect(computeStreaks(['2026-09-13'], TODAY)).toEqual({ current: 0, longest: 1, total: 1 });
  });
});

describe('computeStreaks - 当前连续', () => {
  it('连续 5 天且含今天', () => {
    expect(computeStreaks(consecutive(TODAY, 5), TODAY).current).toBe(5);
  });

  it('连续 5 天但今天还没打卡，当前连续仍算 5', () => {
    const days = consecutive('2026-09-14', 5);
    expect(computeStreaks(days, TODAY).current).toBe(5);
  });

  it('连续段在 3 天前就断了，当前连续归零', () => {
    const days = consecutive('2026-09-12', 5);
    expect(computeStreaks(days, TODAY).current).toBe(0);
  });

  it('今天打卡了、昨天漏了：当前连续只算今天这一天', () => {
    expect(computeStreaks(['2026-09-15', '2026-09-13', '2026-09-12'], TODAY).current).toBe(1);
  });
});

describe('computeStreaks - 最长连续', () => {
  it('最长的一段出现在中间，而不是最近的一段', () => {
    const days = [
      ...consecutive('2026-09-05', 6), // 8/31 - 9/5，连续 6 天
      ...consecutive('2026-09-15', 2), // 9/14 - 9/15，连续 2 天
    ];
    const result = computeStreaks(days, TODAY);
    expect(result.longest).toBe(6);
    expect(result.current).toBe(2);
    expect(result.total).toBe(8);
  });

  it('两段一样长时取该长度', () => {
    const days = [...consecutive('2026-09-02', 3), ...consecutive('2026-09-15', 3)];
    expect(computeStreaks(days, TODAY).longest).toBe(3);
  });
});

describe('computeStreaks - 输入健壮性', () => {
  it('乱序输入不影响结果', () => {
    const ordered = consecutive(TODAY, 4);
    const shuffled = [ordered[2], ordered[0], ordered[3], ordered[1]];
    expect(computeStreaks(shuffled, TODAY)).toEqual(computeStreaks(ordered, TODAY));
  });

  it('重复日期只算一次', () => {
    expect(computeStreaks(['2026-09-15', '2026-09-15', '2026-09-14'], TODAY)).toEqual({
      current: 2,
      longest: 2,
      total: 2,
    });
  });

  it('跨月连续', () => {
    expect(computeStreaks(consecutive('2026-09-02', 5), '2026-09-02').longest).toBe(5);
  });

  it('跨年连续', () => {
    const days = ['2026-12-30', '2026-12-31', '2027-01-01'];
    expect(computeStreaks(days, '2027-01-01')).toEqual({ current: 3, longest: 3, total: 3 });
  });
});
