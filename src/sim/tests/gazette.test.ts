import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { gazetteEditions } from '../selectors/gazetteSelectors';

describe('Town Gazette', () => {
  it('produces editions with leads, briefs, and a market ticker', () => {
    const sim = newSim(1);
    const tpd = ticksPerDay(sim.getState().config);
    sim.run(tpd * 5 + 1);
    const editions = gazetteEditions(sim.getState(), 7);

    expect(editions.length).toBeGreaterThan(0);
    // Today first, strictly descending days.
    for (let i = 1; i < editions.length; i++) {
      expect(editions[i]!.day).toBeLessThan(editions[i - 1]!.day);
    }
    // Completed days carry a market ticker with real prices.
    const withTicker = editions.filter((e) => e.ticker.length > 0);
    expect(withTicker.length).toBeGreaterThan(0);
    expect(withTicker[0]!.ticker.join(' ')).toMatch(/Bread \$\d/);
    // At least one edition has a lead story (mission/achievement/news land early).
    expect(editions.some((e) => e.lead !== null)).toBe(true);
  });
});
