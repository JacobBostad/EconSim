import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import type { Command } from '../core/Commands';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { serialize, deserialize } from '../persistence/saveLoad';
import { ticksPerDay } from '../core/Tick';

/** A running City-preset sim (crowd cohorts ON), resumed and ready to tick. */
function newCitySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

const SCRIPT: Command[] = [
  { type: 'SET_PRICE', firmId: 'firm_2', productId: 'bread', price: 380 },
  { type: 'HIRE_WORKER', facilityId: 'fac_1', citizenId: null },
];

function runScripted(seed: number, ticks: number): string {
  const sim = newSim(seed);
  for (let i = 0; i < ticks; i++) {
    if (i === 100) for (const c of SCRIPT) sim.dispatch(c);
    sim.tick();
  }
  return normalizedSerialize(sim.getState());
}

describe('Determinism', () => {
  it('produces identical state for the same seed and command sequence', () => {
    const a = runScripted(1234, 800);
    const b = runScripted(1234, 800);
    expect(a).toBe(b);
  });

  it('produces different state for different seeds', () => {
    const a = runScripted(1, 500);
    const b = runScripted(2, 500);
    expect(a).not.toBe(b);
  });

  it('rng state advances deterministically', () => {
    const s1 = newSim(99);
    const s2 = newSim(99);
    s1.run(250);
    s2.run(250);
    expect(s1.getState().rngState).toBe(s2.getState().rngState);
  });
});

/**
 * City-preset determinism — the crowd economy must be as reproducible as the
 * classic town. This locks the two places A3 could leak nondeterminism: the
 * curator's createCitizen path (the ONE shared-rng draw in cohort code, taken
 * only in crowd towns) and CohortSocialSystem's float sums (satisfaction, tier
 * gates, migration) — sorted-key iteration must make them bit-stable.
 */
describe('Determinism (City preset — the crowd economy)', () => {
  it('two City sims at the same seed serialize identically after 40 days', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 40);
    b.run(tpd * 40);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
  });

  it('save/load-continue equals an uninterrupted run (20d + load + 20d == 40d)', () => {
    const tpd = ticksPerDay(DEFAULT_CONFIG);

    // Straight run: 40 days uninterrupted.
    const straight = newCitySim(7);
    straight.run(tpd * 40);

    // Interrupted run: 20 days, save, load into a fresh sim, 20 more days.
    const first = newCitySim(7);
    first.run(tpd * 20);
    const reloaded = new Simulation(deserialize(serialize(first.getState())));
    reloaded.dispatch({ type: 'RESUME' });
    reloaded.run(tpd * 20);

    expect(normalizedSerialize(reloaded.getState())).toBe(
      normalizedSerialize(straight.getState()),
    );
  });
});
