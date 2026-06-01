/**
 * citizenSelectors — population-level aggregates and per-citizen views.
 */

import type { GameState } from '../core/GameState';
import type { Citizen } from '../entities/Citizen';
import type { CitizenId, FirmId } from '../core/Id';
import { average } from '../../utils/math';

export function getCitizen(state: GameState, id: CitizenId): Citizen | undefined {
  return state.citizens[id];
}

export function allCitizens(state: GameState): Citizen[] {
  return Object.values(state.citizens);
}

export function citizensByEmployer(state: GameState, firmId: FirmId): Citizen[] {
  return allCitizens(state).filter((c) => c.employerFirmId === firmId);
}

export interface PopulationStats {
  total: number;
  employed: number;
  unemployed: number;
  employmentRate: number;
  averageWage: number;
  averageCash: number;
  averageSatisfaction: number;
  totalUnmetNeedsToday: number;
}

export function populationStats(state: GameState): PopulationStats {
  const citizens = allCitizens(state);
  const employed = citizens.filter((c) => c.employmentStatus === 'employed');
  const wages = employed.map((c) => c.wage);
  return {
    total: citizens.length,
    employed: employed.length,
    unemployed: citizens.length - employed.length,
    employmentRate: citizens.length ? employed.length / citizens.length : 0,
    averageWage: Math.round(average(wages)),
    averageCash: Math.round(average(citizens.map((c) => c.cash))),
    averageSatisfaction: average(citizens.map((c) => c.satisfaction)),
    totalUnmetNeedsToday: citizens.reduce((s, c) => s + c.dailyStats.unmetNeeds, 0),
  };
}

/** A short description of what a citizen is doing right now. */
export function citizenActionLabel(c: Citizen): string {
  switch (c.activity) {
    case 'sleeping': return 'At home (resting)';
    case 'home': return 'At home';
    case 'commuting-to-work': return 'Commuting to work';
    case 'working': return 'Working';
    case 'commuting-to-shop': return 'Heading to a store';
    case 'shopping': return 'Shopping';
    case 'commuting-home': return 'Heading home';
    default: return c.activity;
  }
}
