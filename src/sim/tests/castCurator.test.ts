import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { districtAt } from '../entities/District';
import type { GameState } from '../core/GameState';
import { serialize, deserialize } from '../persistence/saveLoad';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

const TIERS = ['worker', 'comfortable', 'affluent'] as const;

/**
 * Independent re-implementation of the curator's largest-remainder
 * apportionment — the test must not trust the system's own arithmetic. Returns
 * per-stratum cast counts and their target seats.
 */
function apportion(state: GameState): {
  keys: string[];
  cast: Record<string, number>;
  seats: Record<string, number>;
} {
  const keys: string[] = [];
  for (const did of Object.keys(state.districts).sort()) {
    for (const tier of TIERS) keys.push(`${did}:${tier}`);
  }
  const cast: Record<string, number> = {};
  const pop: Record<string, number> = {};
  for (const k of keys) {
    cast[k] = 0;
    pop[k] = 0;
  }
  let castTotal = 0;
  for (const cid of Object.keys(state.citizens)) {
    const c = state.citizens[cid]!;
    const home = state.facilities[c.homeFacilityId];
    if (!home) continue;
    const d = districtAt(state.districts, home.location.x, home.location.y);
    const key = `${d ? d.id : ''}:${c.tier}`;
    if (cast[key] === undefined) continue;
    cast[key] += 1;
    castTotal += 1;
  }
  let totalPop = castTotal;
  for (const k of keys) {
    const crowd = state.cohorts[k]?.population ?? 0;
    pop[k] = cast[k]! + crowd;
    totalPop += crowd;
  }
  const seats: Record<string, number> = {};
  const rem: { key: string; rem: number }[] = [];
  let assigned = 0;
  for (const k of keys) {
    const raw = totalPop > 0 ? (castTotal * pop[k]!) / totalPop : 0;
    const fl = Math.floor(raw);
    seats[k] = fl;
    assigned += fl;
    rem.push({ key: k, rem: raw - fl });
  }
  rem.sort((a, b) => b.rem - a.rem || (a.key < b.key ? -1 : 1));
  for (let i = 0; i < castTotal - assigned && i < rem.length; i++) {
    seats[rem[i]!.key] = seats[rem[i]!.key]! + 1;
  }
  return { keys, cast, seats };
}

describe('Cast curator (world-scale A3 slice 4)', () => {
  it('village towns stay dark: the curator never retires or promotes anyone', () => {
    const sim = newSim(11);
    sim.run(ticksPerDay(sim.getState().config) * 10);
    const state = sim.getState();
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    const curated = state.events.filter(
      (e) => e.message.includes('settled into the crowd') || e.message.includes('stepped out of'),
    );
    expect(curated).toHaveLength(0);
    // No cohort account ever received or paid a retirement/promotion flow.
    const cohortFlows = state.transactions.filter(
      (t) => t.note.startsWith('Retired ') || t.note.startsWith('Promoted '),
    );
    expect(cohortFlows).toHaveLength(0);
  });

  it('after 60 days every stratum sits within +-2 of its apportionment', () => {
    const sim = citySim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 60);
    const { keys, cast, seats } = apportion(state);
    for (const k of keys) {
      expect(Math.abs((cast[k] ?? 0) - (seats[k] ?? 0))).toBeLessThanOrEqual(2);
    }
  });

  it('changes the cast in balanced, population-neutral swaps, bounded per day', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    let totalRetires = 0;
    let totalPromotes = 0;
    for (let d = 0; d < 45; d++) {
      const before = state.events.length;
      const countBefore = Object.keys(state.citizens).length;
      sim.run(tpd);
      const dayEvents = state.events.slice(before);
      const retires = dayEvents.filter((e) => e.message.includes('settled into the crowd')).length;
      const promotes = dayEvents.filter((e) => e.message.includes('stepped out of')).length;
      // Bounded per day: the curator drains an apportionment backlog but never
      // more than MAX_SWAPS_PER_DAY (8) swaps in a single day.
      expect(retires).toBeLessThanOrEqual(8);
      expect(promotes).toBeLessThanOrEqual(8);
      // Every curator swap is atomic: one out, one in — never a lone half.
      expect(retires).toBe(promotes);
      totalRetires += retires;
      totalPromotes += promotes;
      // The curator itself is population-neutral: any citizen-count change on a
      // swap day is fully explained by immigration/emigration that same day.
      const countAfter = Object.keys(state.citizens).length;
      const arrivals = dayEvents.filter(
        (e) => e.message.includes('moved to town') || e.message.includes('arrives with a trade'),
      ).length;
      const departures = dayEvents.filter((e) => e.message.includes('packed up and left')).length;
      expect(countAfter - countBefore).toBe(arrivals - departures);
    }
    // The curator was actually exercised (not a vacuously-passing run).
    expect(totalRetires).toBeGreaterThan(0);
    expect(totalPromotes).toBe(totalRetires);
  });

  it('conserves money to the cent across a 60-day curated run', () => {
    const sim = citySim(7);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    for (let d = 0; d < 60; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
      for (const cid in state.cohorts) {
        expect(state.cohorts[cid]!.cashPool).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a promoted citizen arrives whole and joins the economy', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const promotes: { id: string; tick: number }[] = [];
    let firstOk = false;
    for (let d = 0; d < 60; d++) {
      const before = state.events.length;
      sim.run(tpd);
      for (const e of state.events.slice(before)) {
        if (e.message.includes('stepped out of') && e.entityId) {
          const id = e.entityId as string;
          promotes.push({ id, tick: state.tick });
          if (!firstOk) {
            firstOk = true;
            const c = state.citizens[id]!;
            // Whole at birth: needs, a real home, and a slice of the crowd's cash.
            expect(c).toBeTruthy();
            expect(c.needs.length).toBeGreaterThan(0);
            expect(state.facilities[c.homeFacilityId]).toBeTruthy();
            expect(c.cash).toBeGreaterThan(0);
            expect(c.tierStreak).toBe(0);
          }
        }
      }
    }
    expect(promotes.length).toBeGreaterThan(0);
    // Someone the curator promoted went on to hold a job or shop the town.
    let participated = false;
    for (const p of promotes) {
      const c = state.citizens[p.id];
      if (!c) continue;
      if (c.employmentStatus === 'employed' || c.lastShopTick > p.tick) {
        participated = true;
        break;
      }
    }
    expect(participated).toBe(true);
  });

  it('a curated city round-trips through save/load', () => {
    const sim = citySim(4);
    sim.run(ticksPerDay(sim.getState().config) * 30);
    const state = sim.getState();
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    // Cohorts (including the comfortable/affluent ones the curator seeds)
    // survive the trip.
    expect(Object.keys(again.cohorts).sort()).toEqual(Object.keys(state.cohorts).sort());
  });
});
