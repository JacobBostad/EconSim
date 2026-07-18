/**
 * seasons.ts — the cyclical layer under the random world events.
 *
 * Four 30-day seasons rotate forever: spring, summer, autumn, winter. They
 * modify the same levers as world events (production, demand, transport) and
 * COMBINE with them multiplicatively — a summer drought is survivable, a
 * winter fuel spike hurts. Pure functions of the day; nothing is stored.
 *
 *   Farms:    spring 1.1 · summer 1.2 · autumn 1.0 · winter 0.65
 *   Clothes:  winter 1.35, autumn 1.1 (people bundle up)
 *   Bread:    winter 1.1 (comfort food)
 *   Freight:  winter 1.25 (snowed roads)
 */

import type { GameState } from '../core/GameState';
import type { ProductId } from '../core/Id';
import type { Facility } from '../entities/Facility';
import { ticksPerDay } from '../core/Tick';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_LENGTH_DAYS = 30;
const ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_META: Record<Season, { icon: string; name: string }> = {
  spring: { icon: '🌸', name: 'Spring' },
  summer: { icon: '☀️', name: 'Summer' },
  autumn: { icon: '🍂', name: 'Autumn' },
  winter: { icon: '❄️', name: 'Winter' },
};

export function seasonOfDay(day: number): Season {
  return ORDER[Math.floor(day / SEASON_LENGTH_DAYS) % 4]!;
}

export function seasonOf(state: GameState): Season {
  return seasonOfDay(Math.floor(state.tick / ticksPerDay(state.config)));
}

/** Days until the current season ends (1 = last day). */
export function daysLeftInSeason(state: GameState): number {
  const day = Math.floor(state.tick / ticksPerDay(state.config));
  return SEASON_LENGTH_DAYS - (day % SEASON_LENGTH_DAYS);
}

const FARM_MULT: Record<Season, number> = {
  spring: 1.1,
  summer: 1.2,
  autumn: 1.0,
  winter: 0.65,
};

export function seasonProductionMult(state: GameState, type: Facility['type']): number {
  if (type !== 'farm') return 1;
  return FARM_MULT[seasonOf(state)];
}

export function seasonDemandMult(state: GameState, productId: ProductId): number {
  const season = seasonOf(state);
  if (productId === 'clothes') {
    if (season === 'winter') return 1.35;
    if (season === 'autumn') return 1.1;
  }
  if (productId === 'bread' && season === 'winter') return 1.1;
  return 1;
}

export function seasonTransportMult(state: GameState): number {
  return seasonOf(state) === 'winter' ? 1.25 : 1;
}
