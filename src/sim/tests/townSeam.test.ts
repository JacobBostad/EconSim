/**
 * townSeam.test.ts — the region's town seam (region.md step 3, first slice).
 *
 * The seam lands the Town as a VIEW over the flat GameState (option (b)): the
 * accessor `townOf(state, townId)` returns the same record objects the flat
 * paths hold, so every converted call site is provably behaviour-identical, and
 * because the view is computed (never serialized) no `towns` key enters a save —
 * zero migration, byte-unchanged. These tests pin those three guarantees:
 *
 *   1. accessor identity — `townOf(...).districts === state.districts` (same ref);
 *   2. the seam threads — `makeContext(state).townId === HOME_TOWN_ID`;
 *   3. serialization is unpolluted — no `towns` key leaks into a save;
 *
 * and that the district family, run through the converted systems, stays
 * deterministic (two City runs agree bit-for-bit on the districts and rngState).
 * Bit-identity against the pre-refactor pinned baselines is the orchestrator's
 * job (village seeds 11/4/7 rngState pins, city seed 11) — this file guards the
 * accessor's contract, not the whole trajectory.
 */

import { describe, it, expect } from 'vitest';
import { normalizedSerialize } from './helpers';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { makeContext } from '../core/GameState';
import { townOf, HOME_TOWN_ID } from '../core/Town';
import { ticksPerDay } from '../core/Tick';
import { serialize } from '../persistence/saveLoad';

/** A running City-preset sim (crowd cohorts + districts live), resumed. */
function newCitySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Town seam — accessor is a view over the flat records (region.md step 3)', () => {
  it('townOf(state,"home") returns the SAME record objects as the flat paths', () => {
    const state = newCitySim(11).getState();
    const town = townOf(state, HOME_TOWN_ID);
    // The whole point of option (b): the accessor aliases, it does not copy.
    expect(town.districts).toBe(state.districts);
    expect(town.cohorts).toBe(state.cohorts);
    expect(town.id).toBe('home');
  });

  it('the townId argument defaults to the home town (one-town region)', () => {
    const state = newCitySim(11).getState();
    // A bare-`state` helper mid-gradient calls townOf(state) with no id and must
    // resolve to the same records — identity is independent of the argument.
    expect(townOf(state).districts).toBe(state.districts);
    expect(townOf(state).cohorts).toBe(state.cohorts);
    expect(townOf(state).id).toBe('home');
    expect(townOf(state, HOME_TOWN_ID).districts).toBe(townOf(state).districts);
  });

  it('the view tracks the live record even after the economy mutates it', () => {
    const sim = newCitySim(11);
    const town = townOf(sim.getState(), HOME_TOWN_ID);
    sim.run(ticksPerDay(sim.getState().config) * 10);
    // desirability is rewritten daily by the (converted) DistrictSystem; the
    // getter still returns the live object, not a day-0 snapshot.
    expect(town.districts).toBe(sim.getState().districts);
    for (const id of Object.keys(town.districts)) {
      expect(town.districts[id]!.desirability).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Town seam — the context carries the town', () => {
  it('makeContext threads the home town id', () => {
    const state = newCitySim(11).getState();
    expect(makeContext(state).townId).toBe(HOME_TOWN_ID);
    expect(makeContext(state).townId).toBe('home');
  });
});

describe('Town seam — the view is never serialized (no migration, byte-unchanged)', () => {
  it('a save carries no "towns" key — the view is computed, not stored', () => {
    const state = newCitySim(11).getState();
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    expect('towns' in raw).toBe(false);
    // The flat records still serialize exactly as before the seam.
    expect(raw.districts).toBeTruthy();
    expect('cohorts' in raw).toBe(true);
  });

  it('a "towns" key never appears after a City run either', () => {
    const sim = newCitySim(11);
    sim.run(ticksPerDay(sim.getState().config) * 20);
    const raw = JSON.parse(serialize(sim.getState())) as Record<string, unknown>;
    expect('towns' in raw).toBe(false);
  });
});

describe('Town seam — the converted district family stays deterministic', () => {
  it('two City runs agree bit-for-bit through the converted district systems', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 30);
    b.run(tpd * 30);
    // rngState and the full serialized state — the district readers now route
    // through townOf, and the run is still reproducible to the byte.
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    // And every district object the converted DistrictSystem wrote is identical.
    const da = a.getState().districts;
    const db = b.getState().districts;
    for (const id of Object.keys(da)) {
      expect(da[id]!.desirability).toBe(db[id]!.desirability);
      expect(da[id]!.landValue).toBe(db[id]!.landValue);
    }
  });
});
