import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';

/**
 * Catastrophic-regression perf guard. Local measurement is ~0.20ms/tick at
 * day 300 with everything live; the 2ms bound leaves ~10× headroom locally
 * and ~4× on slower CI runners, so this only trips when something is truly
 * wrong (an accidental O(n²) in a hot loop, an unbounded log, a system
 * running every tick that should run daily). It is NOT a benchmark — use
 * the scratchpad perf probe for real numbers.
 */
describe('Performance guard', () => {
  it('stays far under 2ms/tick through 100 busy days', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'coffee' });

    sim.run(ticksPerDay(state.config) * 100 + 1);

    expect(state.perf.avgTickMs).toBeLessThan(2);
    // The bounded logs really are bounded.
    expect(state.events.length).toBeLessThanOrEqual(state.config.maxEvents);
    expect(state.transactions.length).toBeLessThanOrEqual(state.config.maxTransactions);
  });
});
