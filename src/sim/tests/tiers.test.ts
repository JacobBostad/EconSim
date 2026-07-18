import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { Rng } from '../core/Random';
import type { GameState } from '../core/GameState';
import { deserialize, serialize } from '../persistence/saveLoad';
import {
  runTierSystem,
  PROMOTION_DAYS,
  AFFLUENT_PROMOTION_DAYS,
  DEMOTION_DAYS,
} from '../systems/TierSystem';

/** Advance the tier clock one "day": place the tick on a boundary and run
 * the system directly, so satisfaction drift and rng stay out of the test. */
function tierDay(state: GameState): void {
  const tpd = ticksPerDay(state.config);
  state.tick += tpd - (state.tick % tpd || tpd) + tpd; // next boundary
  runTierSystem({
    state,
    config: state.config,
    rng: new Rng(state),
    time: computeTime(state.tick, state.config),
  });
}

function firstCitizen(state: GameState) {
  return state.citizens[Object.keys(state.citizens)[0]!]!;
}

describe('Prosperity tiers', () => {
  it('steady wages and satisfaction promote after the streak, not before', () => {
    const state = newSim(1).getState();
    const cit = firstCitizen(state);
    cit.employmentStatus = 'employed';
    cit.wage = 20_00;
    cit.satisfaction = 65;
    for (let d = 0; d < PROMOTION_DAYS - 1; d++) tierDay(state);
    expect(cit.tier).toBe('worker'); // one day short
    tierDay(state);
    expect(cit.tier).toBe('comfortable');
    expect(cit.tierStreak).toBe(0);

    // Onward to affluent: better pay, happier, savings in the bank.
    cit.wage = 30_00;
    cit.satisfaction = 80;
    cit.cash = 700_00;
    for (let d = 0; d < AFFLUENT_PROMOTION_DAYS; d++) tierDay(state);
    expect(cit.tier).toBe('affluent');
  });

  it('a broken streak resets — one middling day undoes the climb', () => {
    const state = newSim(1).getState();
    const cit = firstCitizen(state);
    cit.employmentStatus = 'employed';
    cit.wage = 20_00;
    cit.satisfaction = 65;
    for (let d = 0; d < PROMOTION_DAYS - 1; d++) tierDay(state);
    cit.satisfaction = 50; // dips below the entry bar (but above worker floor)
    tierDay(state);
    expect(cit.tier).toBe('worker');
    expect(cit.tierStreak).toBe(0);
    cit.satisfaction = 65;
    for (let d = 0; d < PROMOTION_DAYS - 1; d++) tierDay(state);
    expect(cit.tier).toBe('worker'); // the streak started over
  });

  it('losing the floor demotes only after sustained failure', () => {
    const state = newSim(1).getState();
    const cit = firstCitizen(state);
    cit.tier = 'comfortable';
    cit.employmentStatus = 'employed';
    cit.wage = 20_00;
    cit.satisfaction = 65;
    tierDay(state);
    expect(cit.tier).toBe('comfortable'); // holding the floor is fine

    cit.employmentStatus = 'unemployed'; // floor broken
    for (let d = 0; d < DEMOTION_DAYS - 1; d++) tierDay(state);
    expect(cit.tier).toBe('comfortable'); // not yet
    tierDay(state);
    expect(cit.tier).toBe('worker');
  });

  it('affluent needs housing or savings, and the ascent makes the news', () => {
    const state = newSim(1).getState();
    const cit = firstCitizen(state);
    cit.tier = 'comfortable';
    cit.employmentStatus = 'employed';
    cit.wage = 30_00;
    cit.satisfaction = 80;
    cit.cash = 100_00; // no savings, and home is a plain house
    for (let d = 0; d < AFFLUENT_PROMOTION_DAYS + 2; d++) tierDay(state);
    expect(cit.tier).toBe('comfortable'); // the housing/savings bar gates it

    cit.cash = 700_00;
    for (let d = 0; d < AFFLUENT_PROMOTION_DAYS; d++) tierDay(state);
    expect(cit.tier).toBe('affluent');
    expect(state.events.some((e) => e.message.includes('is prospering'))).toBe(true);
  });

  it('runs inside the full sim without disturbing determinism', () => {
    const a = newSim(4);
    const b = newSim(4);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 30);
    b.run(tpd * 30);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    // Tiers derived for every citizen.
    for (const cid in a.getState().citizens) {
      expect(['worker', 'comfortable', 'affluent']).toContain(a.getState().citizens[cid]!.tier);
    }
  });

  it('pre-tier saves migrate with a sensible snapshot guess', () => {
    const state = newSim(2).getState();
    const cit = firstCitizen(state);
    cit.employmentStatus = 'employed';
    cit.wage = 30_00;
    cit.satisfaction = 80;
    cit.cash = 700_00;
    const raw = JSON.parse(serialize(state)) as {
      citizens: Record<string, Record<string, unknown>>;
    };
    for (const cid in raw.citizens) {
      delete raw.citizens[cid]!.tier;
      delete raw.citizens[cid]!.tierStreak;
    }
    const migrated = deserialize(JSON.stringify(raw));
    const mcit = migrated.citizens[Object.keys(migrated.citizens)[0]!]!;
    expect(mcit.tier).toBe('affluent'); // snapshot heuristic saw the good life
    expect(mcit.tierStreak).toBe(0);
    for (const cid in migrated.citizens) {
      expect(['worker', 'comfortable', 'affluent']).toContain(migrated.citizens[cid]!.tier);
    }
  });
});
