import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { serialize, deserialize } from '../persistence/saveLoad';
import { emptyCohort } from '../entities/Cohort';
import { dollars } from '../data/constants';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

function residentialDistrictId(sim: Simulation): string {
  const state = sim.getState();
  for (const id of Object.keys(state.districts).sort()) {
    if (state.districts[id]!.kind === 'residential') return id;
  }
  throw new Error('no residential district');
}

describe('Cohort social (world-scale A3 slice 3)', () => {
  it('village towns stay dark: no satisfaction, tier, or migration flow ever runs', () => {
    const sim = newSim(11);
    sim.run(ticksPerDay(sim.getState().config) * 5);
    const state = sim.getState();
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    // Nothing ever moved between cohort accounts (tier moves / migration).
    const cohortFlow = state.transactions.filter(
      (t) => t.from.kind === 'cohort' || t.to.kind === 'cohort',
    );
    expect(cohortFlow).toHaveLength(0);
  });

  it('cohort satisfaction tracks its equilibrium and never leaves [0, 100]', () => {
    const sim = citySim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 30);
    let populated = 0;
    for (const cid in state.cohorts) {
      const c = state.cohorts[cid]!;
      expect(c.avgSatisfaction).toBeGreaterThanOrEqual(0);
      expect(c.avgSatisfaction).toBeLessThanOrEqual(100);
      if (c.population > 0) {
        populated += 1;
        // Drifting toward an equilibrium set by circumstance, not pinned at a
        // rail — a saturated 0/100 would mean the formula stopped tracking.
        expect(c.avgSatisfaction).toBeGreaterThan(0);
        expect(c.avgSatisfaction).toBeLessThan(100);
      }
    }
    expect(populated).toBeGreaterThan(0);
  });

  it('a well-paid, well-fed worker cohort promotes mass into comfortable within ~60 days', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const districtId = residentialDistrictId(sim);
    // A crowd small enough for the shops to keep fed, flush with savings and
    // content — the savings route plus high satisfaction clears the bar.
    const worker = state.cohorts[`${districtId}:worker`]!;
    worker.population = 50;
    worker.avgSatisfaction = 80;
    worker.cashPool = worker.population * dollars(1000);
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config) * 60);

    const comfortable = state.cohorts[`${districtId}:comfortable`];
    expect(comfortable).toBeTruthy();
    expect(comfortable!.population).toBeGreaterThan(0);
    expect(comfortable!.cashPool).toBeGreaterThan(0);
    expect(comfortable!.employed).toBeLessThanOrEqual(comfortable!.population);
    // The tier move carried real money — supply is conserved to the cent.
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('a jobless, miserable comfortable cohort demotes into worker within ~10 days', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const districtId = residentialDistrictId(sim);
    // Replace the crowd with one struggling comfortable block: no jobs, low
    // satisfaction, and savings under the floor.
    state.cohorts = {};
    const comfortable = emptyCohort(districtId, 'comfortable');
    comfortable.population = 100;
    comfortable.employed = 0;
    comfortable.avgSatisfaction = 20;
    comfortable.cashPool = dollars(1) * comfortable.population;
    state.cohorts[comfortable.id] = comfortable;
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config) * 10);

    const worker = state.cohorts[`${districtId}:worker`];
    expect(worker).toBeTruthy();
    expect(worker!.population).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('migration inflow grows a satisfied crowd, and never breaches the cohort cap', () => {
    const sim = citySim(7);
    const state = sim.getState();
    const cid = Object.keys(state.cohorts).sort()[0]!;
    const cohort = state.cohorts[cid]!;
    // Right up against the cap, thoroughly content: inflow should push toward
    // the ceiling and stop there, never over.
    cohort.population = 1990;
    cohort.avgSatisfaction = 95;
    cohort.cashPool = cohort.population * dollars(50);
    for (const id in state.citizens) state.citizens[id]!.satisfaction = 95;
    const cap = SIZE_PRESETS.city.cohortCap;
    const start = cohort.population;
    const supply0 = totalMoneySupply(state);

    let maxCrowd = start;
    const tpd = ticksPerDay(state.config);
    for (let day = 0; day < 12; day++) {
      sim.run(tpd);
      let crowd = 0;
      for (const k in state.cohorts) crowd += state.cohorts[k]!.population;
      maxCrowd = Math.max(maxCrowd, crowd);
      expect(crowd).toBeLessThanOrEqual(cap);
    }
    expect(maxCrowd).toBeGreaterThan(start); // arrivals really did come
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('money is conserved to the cent through a 30-day city run', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    for (let d = 0; d < 30; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
      for (const cid in state.cohorts) {
        expect(state.cohorts[cid]!.cashPool).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a city with tier mobility round-trips through save/load', () => {
    const sim = citySim(11);
    const state = sim.getState();
    // Nudge a promotion so more than the bootstrap worker cohort exists.
    const districtId = residentialDistrictId(sim);
    const worker = state.cohorts[`${districtId}:worker`]!;
    worker.population = 50;
    worker.avgSatisfaction = 80;
    worker.cashPool = worker.population * dollars(1000);
    sim.run(ticksPerDay(state.config) * 12);

    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    for (const cid in state.cohorts) {
      expect(again.cohorts[cid]!.dayEvents).toEqual(state.cohorts[cid]!.dayEvents);
      expect(again.cohorts[cid]!.avgSatisfaction).toBe(state.cohorts[cid]!.avgSatisfaction);
    }
  });
});
