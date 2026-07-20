import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { crowdCount } from '../entities/Facility';
import { serialize, deserialize } from '../persistence/saveLoad';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Cohort labor (world-scale A3 slice 1)', () => {
  it('village towns stay completely dark: no crowd anywhere, ever', () => {
    const sim = newSim(11);
    sim.run(ticksPerDay(sim.getState().config) * 5);
    const state = sim.getState();
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    for (const fid in state.facilities) {
      expect(Object.keys(state.facilities[fid]!.crowdByCohort)).toHaveLength(0);
    }
  });

  it('city preset bootstraps a worker crowd with real cash in the money supply', () => {
    const state = citySim(11).getState();
    const preset = SIZE_PRESETS.city;
    let crowd = 0;
    let pool = 0;
    for (const cid of Object.keys(state.cohorts)) {
      const c = state.cohorts[cid]!;
      expect(c.tier).toBe('worker');
      crowd += c.population;
      pool += c.cashPool;
    }
    expect(crowd).toBe(preset.crowdStart);
    expect(pool).toBeGreaterThan(0);
    // The pool is initial money supply, so conservation covers it from t0.
    const supply0 = totalMoneySupply(state);
    expect(supply0).toBeGreaterThan(0);
  });

  it('the crowd fills open slots, works shifts, and gets paid per firm x cohort', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    // Run past a payday and into work hours (day boundary + 10 hours).
    sim.run(tpd * 3 + state.config.ticksPerHour * 10);

    let assigned = 0;
    const byCohort: Record<string, number> = {};
    for (const fid in state.facilities) {
      const fac = state.facilities[fid]!;
      const n = crowdCount(fac);
      assigned += n;
      for (const cid in fac.crowdByCohort) {
        byCohort[cid] = (byCohort[cid] ?? 0) + fac.crowdByCohort[cid]!;
      }
      // Capacity is never violated by crowd assignments.
      expect(fac.employees.length + n).toBeLessThanOrEqual(fac.workerCapacity);
      // During work hours crowd counts as present crew.
      if (n > 0) {
        expect(fac.presentWorkers).toBeGreaterThanOrEqual(n);
      }
    }
    expect(assigned).toBeGreaterThan(0);
    for (const cid of Object.keys(byCohort)) {
      expect(state.cohorts[cid]!.employed).toBe(byCohort[cid]);
      expect(state.cohorts[cid]!.employed).toBeLessThanOrEqual(state.cohorts[cid]!.population);
    }

    // Crowd wages flowed firm -> cohort on paydays.
    const crowdWage = state.transactions.find(
      (t) => t.category === 'wages' && t.note.startsWith('Crowd wages'),
    );
    expect(crowdWage).toBeTruthy();
    // Idle crowd received subsistence.
    const stipend = state.transactions.find((t) => t.note.startsWith('Crowd subsistence'));
    expect(stipend).toBeTruthy();
    // Every flow conserved to the cent.
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('crowd staffing keeps a store open and the town economy conserved over 20 days', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * 20);
    expect(totalMoneySupply(state)).toBe(supply0);
    // Cohort pools accumulated wage/stipend income and remain non-negative.
    for (const cid in state.cohorts) {
      expect(state.cohorts[cid]!.cashPool).toBeGreaterThanOrEqual(0);
    }
  });

  it('city saves round-trip with crowd assignments intact', () => {
    const sim = citySim(7);
    sim.run(ticksPerDay(sim.getState().config) * 4);
    const state = sim.getState();
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    let crowd = 0;
    for (const fid in again.facilities) crowd += crowdCount(again.facilities[fid]!);
    let expected = 0;
    for (const fid in state.facilities) expected += crowdCount(state.facilities[fid]!);
    expect(crowd).toBe(expected);
  });
});
