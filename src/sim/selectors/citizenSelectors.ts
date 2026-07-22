/**
 * citizenSelectors — population-level aggregates and per-citizen views.
 */

import type { GameState } from '../core/GameState';
import type { Citizen } from '../entities/Citizen';
import type { CitizenId, FirmId } from '../core/Id';
import { average } from '../../utils/math';
import { getProduct } from '../data/products';
import { townOf } from '../core/Town';

export function getCitizen(state: GameState, id: CitizenId): Citizen | undefined {
  // Bare-`state` selector mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  return townOf(state).citizens[id];
}

export function allCitizens(state: GameState): Citizen[] {
  return Object.values(townOf(state).citizens);
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
  const citizens = townOf(state).citizens;
  for (const id in citizens) {
    const c = citizens[id]!;
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
      const c = townOf(state).citizens[cid];
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

// ---------------------------------------------------------------------------
// Spending power — where the town's money goes
// ---------------------------------------------------------------------------

export interface SpendingPower {
  averageCash: number;
  /** Sum across citizens, today so far. */
  wagesEarnedToday: number;
  spentToday: number;
  purchasesToday: number;
  /** Yesterday's citizen spend per product (avgPrice × unitsSold), desc. */
  spendByProduct: { productId: string; name: string; amount: number }[];
  /** Products whose unmet demand exceeded sales yesterday — hungry markets. */
  hungryMarkets: string[];
}

export function spendingPower(state: GameState): SpendingPower {
  const citizens = allCitizens(state);
  let wages = 0, spent = 0, purchases = 0;
  for (const c of citizens) {
    wages += c.dailyStats.wagesEarned;
    spent += c.dailyStats.spent;
    purchases += c.dailyStats.purchases;
  }
  const spendByProduct: SpendingPower['spendByProduct'] = [];
  const hungryMarkets: string[] = [];
  // Average urgency per product: catches markets nobody serves at all, which
  // never register unmetDemand (that counter only ticks at store visits).
  const urgencySum: Record<string, number> = {};
  for (const c of citizens) {
    for (const n of c.needs) urgencySum[n.productId] = (urgencySum[n.productId] ?? 0) + n.urgency;
  }
  const marketStats = townOf(state).marketStats;
  for (const pid in marketStats) {
    const last = marketStats[pid]!.history.slice(-1)[0];
    if (!last) continue;
    const amount = last.averagePrice * last.unitsSold;
    if (amount > 0) {
      spendByProduct.push({ productId: pid, name: getProduct(pid).name, amount });
    }
    const avgUrgency = citizens.length ? (urgencySum[pid] ?? 0) / citizens.length : 0;
    const served = last.unitsSold > 0;
    if (last.unmetDemand > Math.max(4, last.unitsSold) || (!served && avgUrgency > 1.2)) {
      hungryMarkets.push(getProduct(pid).name);
    }
  }
  spendByProduct.sort((a, b) => b.amount - a.amount);
  return {
    averageCash: Math.round(average(citizens.map((c) => c.cash))),
    wagesEarnedToday: wages,
    spentToday: spent,
    purchasesToday: purchases,
    spendByProduct,
    hungryMarkets,
  };
}
