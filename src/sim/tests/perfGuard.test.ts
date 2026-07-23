import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';

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

  /**
   * Two-town guard (region.md step 4, slice 3): a flag-on City ticks home's full
   * schedule AND the partner's light subset each tick. Measured overhead is small
   * (scratchpad perf probe: flag-off City ~0.22ms/tick, flag-on two-town
   * ~0.27ms/tick, +~0.05ms/24% — the partner's cast-less subset is a fraction of
   * home's cost), so the same 2ms catastrophic-regression bound the one-town
   * guard uses keeps ~7× measured headroom here. Not a benchmark — it trips only
   * on a true regression (e.g. an O(n²) leaking across the town loop).
   */
  it('a flag-on two-town City stays far under 2ms/tick through 100 days', () => {
    const s = createInitialState(11, {
      ...DEFAULT_CONFIG,
      sizePreset: 'city',
      servicesEnabled: true,
      realEstateEnabled: true,
      investorsEnabled: true,
      tradeDemandPoolsEnabled: true,
      regionEnabled: true,
    });
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 100 + 1);
    expect(s.perf.avgTickMs).toBeLessThan(2);
    expect(s.events.length).toBeLessThanOrEqual(s.config.maxEvents);
    expect(s.transactions.length).toBeLessThanOrEqual(s.config.maxTransactions);
  });
});
