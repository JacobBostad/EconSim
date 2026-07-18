import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { laborMarketStats, employerBreakdown } from '../selectors/citizenSelectors';

describe('Labor market selectors', () => {
  it('skill buckets cover the whole population and wages are ordered', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const stats = laborMarketStats(state);
    const bucketTotal = stats.skillBuckets.reduce((a, b) => a + b.count, 0);
    expect(bucketTotal).toBe(Object.keys(state.citizens).length);
    expect(stats.wageMin).toBeLessThanOrEqual(stats.wageMedian);
    expect(stats.wageMedian).toBeLessThanOrEqual(stats.wageMax);
    expect(stats.wageMax).toBeGreaterThan(0);
  });

  it('employer breakdown lists AI firms with staff, skill, and wages', () => {
    const sim = newSim(1);
    const rows = employerBreakdown(sim.getState());
    const ai = rows.filter((r) => !r.isPlayer);
    expect(ai.length).toBe(3);
    for (const r of ai) {
      expect(r.employees).toBeGreaterThan(0);
      expect(r.avgSkill).toBeGreaterThan(0.7);
      expect(r.baseWage).toBeGreaterThan(0);
    }
    // Sorted by headcount, player row present.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.employees).toBeLessThanOrEqual(rows[i - 1]!.employees);
    }
    expect(rows.some((r) => r.isPlayer)).toBe(true);
  });
});
