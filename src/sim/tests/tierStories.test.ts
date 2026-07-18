import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { Rng } from '../core/Random';
import type { GameState } from '../core/GameState';
import type { CitizenTier } from '../entities/Citizen';
import {
  runImmigrationSystem,
  PROSPEROUS_SKILL_BONUS,
  emigrationMutter,
} from '../systems/ImmigrationSystem';

/** Run day-by-day, applying `pin` to the state before each day. */
function runPinned(sim: ReturnType<typeof newSim>, days: number, pin: () => void): void {
  const tpd = ticksPerDay(sim.getState().config);
  for (let d = 0; d < days; d++) {
    pin();
    sim.run(tpd);
  }
}

/** Drive the immigration system directly with the gate held open and the
 * whole town pinned to one tier — rng draws are identical across sims. */
function forceArrivals(state: GameState, tier: CitizenTier, rounds: number): void {
  const tpd = ticksPerDay(state.config);
  for (let i = 0; i < rounds; i++) {
    state.tick += tpd - (state.tick % tpd || tpd) + tpd; // next boundary
    for (const c of Object.values(state.citizens)) {
      c.tier = tier;
      c.satisfaction = 70;
      c.employmentStatus = 'employed';
    }
    runImmigrationSystem({
      state, config: state.config, rng: new Rng(state),
      time: computeTime(state.tick, state.config),
    });
  }
}

describe('Tier-driven town stories', () => {
  it('prosperous towns attract skilled newcomers — same arrival, +0.1 hands', () => {
    // A/B on one seed: identical rng sequences (tier pinning draws none),
    // so every arrival exists in both sims and differs in skill by exactly
    // the prosperity bonus.
    const a = newSim(5).getState();
    const b = newSim(5).getState();
    const before = new Set(Object.keys(a.citizens));
    forceArrivals(a, 'comfortable', 12);
    forceArrivals(b, 'worker', 12);
    const arrivals = Object.keys(a.citizens).filter((id) => !before.has(id));
    expect(arrivals.length).toBeGreaterThan(0);
    for (const id of arrivals) {
      const skillA = a.citizens[id]!.skill;
      const skillB = b.citizens[id]!.skill;
      expect(skillA).toBeCloseTo(Math.min(1.3, Math.round((skillB + PROSPEROUS_SKILL_BONUS) * 100) / 100), 5);
    }
    expect(a.events.some((e) => e.message.includes('Word of the good life'))).toBe(true);
    expect(b.events.some((e) => e.message.includes('Word of the good life'))).toBe(false);
  });

  it('struggling worker towns mutter before anyone actually leaves', () => {
    const sim = newSim(7);
    const state = sim.getState();
    // Find a day the hash gate fires for this seed, then run past it with
    // satisfaction pinned low — but ABOVE the emigration bar (42), so the
    // town grumbles without losing a soul.
    let fireDay = -1;
    for (let d = 1; d < 120; d++) if (emigrationMutter(state.seed, d)) { fireDay = d; break; }
    expect(fireDay).toBeGreaterThan(0);
    const pop0 = Object.keys(state.citizens).length;
    runPinned(sim, fireDay + 2, () => {
      for (const c of Object.values(state.citizens)) {
        c.satisfaction = 45;
        c.tier = 'worker';
      }
    });
    expect(state.events.some((e) => e.message.includes('families talk of leaving'))).toBe(true);
    // Muttering is not moving: above the emigration bar the population holds.
    expect(Object.keys(state.citizens).length).toBeGreaterThanOrEqual(pop0);
  });
});
