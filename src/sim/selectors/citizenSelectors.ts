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


// ---------------------------------------------------------------------------
// Labor market analytics (Population dashboard)
// ---------------------------------------------------------------------------

export interface LaborMarketStats {
  /** Histogram of citizen skill in 5 buckets over [0.7, 1.3]. */
  skillBuckets: { label: string; count: number }[];
  wageMin: number;
  wageMedian: number;
  wageMax: number;
  /** Citizens currently aspiring to luxury goods (urgency > 0.5 on any). */
  luxuryAspirants: number;
}

export function laborMarketStats(state: GameState): LaborMarketStats {
  const buckets = [
    { label: '≤0.85', count: 0 },
    { label: '0.85–0.95', count: 0 },
    { label: '0.95–1.05', count: 0 },
    { label: '1.05–1.15', count: 0 },
    { label: '>1.15', count: 0 },
  ];
  const wages: number[] = [];
  let luxuryAspirants = 0;
  for (const id in state.citizens) {
    const c = state.citizens[id]!;
    const sk = c.skill;
    if (sk <= 0.85) buckets[0]!.count++;
    else if (sk <= 0.95) buckets[1]!.count++;
    else if (sk <= 1.05) buckets[2]!.count++;
    else if (sk <= 1.15) buckets[3]!.count++;
    else buckets[4]!.count++;
    if (c.employmentStatus === 'employed' && c.wage > 0) wages.push(c.wage);
    if (
      c.needs.some(
        (n) =>
          n.urgency > 0.5 &&
          (n.productId === 'pastries' || n.productId === 'jewelry'),
      )
    ) {
      luxuryAspirants++;
    }
  }
  wages.sort((a, b) => a - b);
  return {
    skillBuckets: buckets,
    wageMin: wages[0] ?? 0,
    wageMedian: wages[Math.floor(wages.length / 2)] ?? 0,
    wageMax: wages[wages.length - 1] ?? 0,
    luxuryAspirants,
  };
}

export interface EmployerRow {
  firmId: string;
  name: string;
  isPlayer: boolean;
  employees: number;
  avgSkill: number;
  baseWage: number;
}

/** Who employs the town — with crew skill and pay (poaching intel). */
export function employerBreakdown(state: GameState): EmployerRow[] {
  const rows: EmployerRow[] = [];
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'player' && f.ownerType !== 'ai') continue;
    let skillSum = 0;
    let count = 0;
    for (const cid of f.employees) {
      const c = state.citizens[cid];
      if (c) {
        skillSum += c.skill;
        count++;
      }
    }
    rows.push({
      firmId: fid,
      name: f.name,
      isPlayer: fid === state.playerFirmId,
      employees: count,
      avgSkill: count > 0 ? skillSum / count : 0,
      baseWage: f.wagePolicy.baseWage,
    });
  }
  return rows.sort((a, b) => b.employees - a.employees);
}
