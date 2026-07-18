import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { spendingPower } from '../selectors/citizenSelectors';

describe('spendingPower', () => {
  it('sums household money flows and ranks yesterday\'s product spend', () => {
    const sim = newSim(4);
    const state = sim.getState();
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(state.config) * 5 + Math.floor(ticksPerDay(state.config) / 2));

    const s = spendingPower(state);
    expect(s.averageCash).toBeGreaterThan(0);
    // A running AI town pays wages and sells goods.
    expect(s.spendByProduct.length).toBeGreaterThan(0);
    // Sorted descending.
    for (let i = 1; i < s.spendByProduct.length; i++) {
      expect(s.spendByProduct[i - 1]!.amount).toBeGreaterThanOrEqual(s.spendByProduct[i]!.amount);
    }
    // Coffee has demand but no seller at start: a hungry market.
    expect(s.hungryMarkets).toContain('Coffee');
    // Manual cross-check of the sums.
    const cits = Object.values(state.citizens);
    expect(s.spentToday).toBe(cits.reduce((a, c) => a + c.dailyStats.spent, 0));
    expect(s.wagesEarnedToday).toBe(cits.reduce((a, c) => a + c.dailyStats.wagesEarned, 0));
  });
});
