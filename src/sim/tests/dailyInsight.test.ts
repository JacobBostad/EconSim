import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { dailyInsight } from '../selectors/companySelectors';

describe('dailyInsight', () => {
  it('is null before a full day has been played', () => {
    const sim = newSim(1);
    expect(dailyInsight(sim.getState(), sim.getState().playerFirmId)).toBeNull();
  });

  it('summarizes the last closed day: net, top cost, trend', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    sim.run(ticksPerDay(state.config) * 3 + 1);

    const insight = dailyInsight(state, state.playerFirmId)!;
    expect(insight).not.toBeNull();
    const last = player.accounting.dailyHistory[player.accounting.dailyHistory.length - 1]!;
    expect(insight.day).toBe(last.day);
    expect(insight.net).toBe(last.netProfit);
    // A staffed chain's dominant cost is the wage bill.
    expect(insight.topCostLabel).toBe('wages');
    expect(insight.topCostAmount).toBe(last.wages);
    // Breakdown is sorted largest-first and hides empty buckets.
    for (let i = 1; i < insight.breakdown.length; i++) {
      expect(insight.breakdown[i - 1]!.amount).toBeGreaterThanOrEqual(insight.breakdown[i]!.amount);
    }
    expect(insight.breakdown.every((b) => b.amount > 0)).toBe(true);
    const prior = player.accounting.dailyHistory[player.accounting.dailyHistory.length - 2]!;
    expect(insight.deltaVsPrior).toBe(last.netProfit - prior.netProfit);
  });
});
