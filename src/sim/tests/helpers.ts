/**
 * helpers.ts — shared test utilities.
 */

import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import type { GameState } from '../core/GameState';
import type { Facility } from '../entities/Facility';
import type { Firm } from '../entities/Firm';
import { serialize } from '../persistence/saveLoad';

export function newSim(seed = 1): Simulation {
  const sim = new Simulation(createInitialState(seed));
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

export function findFacilityByName(state: GameState, name: string): Facility {
  for (const id in state.facilities) {
    if (state.facilities[id]!.name === name) return state.facilities[id]!;
  }
  throw new Error(`Facility not found: ${name}`);
}

export function findFirmByName(state: GameState, name: string): Firm {
  for (const id in state.firms) {
    if (state.firms[id]!.name === name) return state.firms[id]!;
  }
  throw new Error(`Firm not found: ${name}`);
}

export function findFacilityByType(state: GameState, type: Facility['type']): Facility {
  for (const id in state.facilities) {
    if (state.facilities[id]!.type === type) return state.facilities[id]!;
  }
  throw new Error(`Facility type not found: ${type}`);
}

/** Set the clock to a given hour on day 0 (no day boundary). */
export function setHour(state: GameState, hour: number): void {
  state.tick = hour * state.config.ticksPerHour;
}

/** Serialize ignoring perf metrics (which depend on wall-clock timing). */
export function normalizedSerialize(state: GameState): string {
  const clone = JSON.parse(serialize(state)) as Record<string, unknown>;
  clone.perf = { lastTickMs: 0, avgTickMs: 0, ticksSimulated: 0 };
  return JSON.stringify(clone);
}
