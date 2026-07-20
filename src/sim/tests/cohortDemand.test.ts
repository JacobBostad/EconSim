import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { serialize, deserialize } from '../persistence/saveLoad';
import { NEED_BUCKETS } from '../entities/Cohort';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Cohort demand (world-scale A3 slice 2)', () => {
  it('village towns stay dark: the crowd never spends because there is no crowd', () => {
    const sim = newSim(11);
    sim.run(ticksPerDay(sim.getState().config) * 5);
    const state = sim.getState();
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    // No money ever moved out of a cohort account.
    const cohortSpend = state.transactions.filter((t) => t.from.kind === 'cohort');
    expect(cohortSpend).toHaveLength(0);
  });

  it('the crowd shops the shelves: cohort-account revenue reaches firms and stats', () => {
    const sim = citySim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 8);

    // Direct settlements: cohort account -> firm account, booked as revenue.
    const crowdBuys = state.transactions.filter(
      (t) => t.from.kind === 'cohort' && t.category === 'revenue' && t.note.startsWith('Crowd bought'),
    );
    expect(crowdBuys.length).toBeGreaterThan(0);
    for (const t of crowdBuys) {
      expect(t.to.kind).toBe('firm');
      expect(t.quantity).toBeGreaterThan(0);
      expect(Number.isInteger(t.quantity)).toBe(true);
      expect(Number.isInteger(t.amount)).toBe(true);
    }

    // The purchases show up in the firms' books and the product market stats.
    let dailyStoreUnits = 0;
    for (const fid in state.facilities) {
      dailyStoreUnits += state.facilities[fid]!.dailyStats.unitsSold;
    }
    let historicUnits = 0;
    for (const pid in state.marketStats) {
      for (const h of state.marketStats[pid]!.history) historicUnits += h.unitsSold;
    }
    expect(dailyStoreUnits + historicUnits).toBeGreaterThan(0);
  });

  it('money is conserved to the cent and cohort pools never go negative over 15 days', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    for (let d = 0; d < 15; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
      for (const cid in state.cohorts) {
        expect(state.cohorts[cid]!.cashPool).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('urgency buckets always stay in [0, 3]', () => {
    const sim = citySim(7);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 20);
    for (const cid in state.cohorts) {
      const buckets = state.cohorts[cid]!.needBuckets;
      for (const pid in buckets) {
        const b = buckets[pid]!;
        expect(b).toHaveLength(NEED_BUCKETS);
        for (const u of b) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('a city with an active crowd economy round-trips through save/load', () => {
    const sim = citySim(11);
    sim.run(ticksPerDay(sim.getState().config) * 6);
    const state = sim.getState();
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    // Buckets survive the trip intact.
    for (const cid in state.cohorts) {
      expect(again.cohorts[cid]!.needBuckets).toEqual(state.cohorts[cid]!.needBuckets);
    }
  });
});
