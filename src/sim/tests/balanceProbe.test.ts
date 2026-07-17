import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';

/**
 * Long-run balance regression: with no player action, the AI-run town must
 * stay economically healthy — markets clear, firms survive, citizens are
 * reasonably satisfied (not pinned at 0 or 100), and money is conserved.
 * Guards against demand/supply tuning drifting out of equilibrium.
 */
describe('Long-run balance (no player action)', () => {
  it('the AI town stays healthy through day 120', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const supply0 = totalMoneySupply(state);

    sim.run(tpd * 120 + 1);

    expect(totalMoneySupply(state)).toBe(supply0);

    // All AI firms alive and solvent.
    for (const f of Object.values(state.firms)) {
      if (f.ownerType !== 'ai') continue;
      expect(f.bankruptcyStatus).toBe('healthy');
      expect(f.cash).toBeGreaterThan(0);
    }

    // Satisfaction sits in a dynamic middle band — neither misery nor nirvana.
    const cits = Object.values(state.citizens);
    const avgSat = cits.reduce((a, c) => a + c.satisfaction, 0) / cits.length;
    expect(avgSat).toBeGreaterThan(55);
    expect(avgSat).toBeLessThan(95);

    // Markets clear: every consumer product sold recently and inventory exists.
    for (const pid of ['bread', 'tools', 'clothes'] as const) {
      const recent = state.marketStats[pid]!.history.slice(-30);
      const sold = recent.reduce((a, h) => a + h.unitsSold, 0);
      expect(sold).toBeGreaterThan(0);
      expect(state.marketStats[pid]!.totalInventory).toBeGreaterThan(0);
      // Chronic-shortage guard: unmet demand stays below sales over a month.
      const unmet = recent.reduce((a, h) => a + h.unmetDemand, 0);
      expect(unmet).toBeLessThan(sold);
    }
  });
});
