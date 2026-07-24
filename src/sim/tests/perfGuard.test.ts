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

/**
 * MEDIAN ms/tick over a timed window — the house statistic. Preferred over the
 * `state.perf.avgTickMs` EWMA for the heavier two-town guards below: a two-town
 * Metropolis carries a ~3.5MB serialized state and allocates hard, so a single
 * multi-ms GC pause corrupts the EWMA mean for many subsequent ticks (the mean
 * reads ~2.6-3.2ms on a GC-heavy CI box while the true central tick is ~0.5ms).
 * The median is immune to those sparse outliers, so it measures the real per-tick
 * cost the 2ms catastrophic bound is meant to guard — same bound, robust stat.
 */
function medianTickMs(sim: Simulation, ticks: number): number {
  const samples: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    sim.tick();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

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
   * on a true regression (e.g. an O(n²) leaking across the town loop). Uses the
   * median stat (see medianTickMs) so a GC pause can't false-trip it.
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
    expect(medianTickMs(sim, ticksPerDay(s.config) * 100 + 1)).toBeLessThan(2);
    expect(s.events.length).toBeLessThanOrEqual(s.config.maxEvents);
    expect(s.transactions.length).toBeLessThanOrEqual(s.config.maxTransactions);
  });

  /**
   * Two-town METROPOLIS guard (region.md step 4): the region now ships at
   * Metropolis too, and a two-town Metropolis is the heaviest per-tick path in
   * the game (biggest map, 30-firm founder field, 10k crowd cap, plus the
   * city-sized partner). The region-metro-perf probe measured the median tick at
   * ~0.5-0.6ms warmed to day 300, and the two-town partner overhead sits BELOW
   * the run-to-run noise floor at this scale (the redundant host-scoped contract
   * index the partner used to rebuild each tick — the one measurable O(towns ×
   * host-size) wart — is gone: partners now carry an empty, unread index). The
   * same 2ms catastrophic-regression bound keeps ~3-4× measured headroom here.
   * Not a benchmark — it trips only on a true regression. Uses the median stat
   * (see medianTickMs) so a GC pause on the heavy 3.5MB state can't false-trip it.
   */
  it('a flag-on two-town Metropolis stays far under 2ms/tick through 100 days', () => {
    const s = createInitialState(11, {
      ...DEFAULT_CONFIG,
      sizePreset: 'metropolis',
      servicesEnabled: true,
      realEstateEnabled: true,
      tradeDemandPoolsEnabled: true,
      regionEnabled: true,
    });
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    expect(medianTickMs(sim, ticksPerDay(s.config) * 100 + 1)).toBeLessThan(2);
    expect(s.events.length).toBeLessThanOrEqual(s.config.maxEvents);
    expect(s.transactions.length).toBeLessThanOrEqual(s.config.maxTransactions);
  });
});
