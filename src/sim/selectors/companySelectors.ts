/**
 * companySelectors — derived views of a firm for dashboards/inspectors.
 * Pure functions over GameState; safe to memoize in the UI.
 */

import type { GameState } from '../core/GameState';
import type { Firm } from '../entities/Firm';
import type { Facility } from '../entities/Facility';
import type { Citizen } from '../entities/Citizen';
import type { FirmId } from '../core/Id';
import { grossProfit, operatingProfit, netProfit } from '../entities/Accounting';
import { getProduct } from '../data/products';
import { OBJECTIVE_LADDER } from '../data/constants';

export interface ObjectiveProgress {
  /** Number of ladder tiers already reached (0..ladder length). */
  reachedTiers: number;
  /** Highest reached tier title, or null before the first win. */
  reachedTitle: string | null;
  /** The next target, or null when the ladder is complete. */
  next: { valuation: number; title: string } | null;
  valuation: number;
}

/** Where the player stands on the escalating objective ladder. */
export function objectiveProgress(state: GameState): ObjectiveProgress {
  const valuation = companyValuation(state, state.playerFirmId).valuation;
  let reachedTiers = 0;
  for (const tier of OBJECTIVE_LADDER) {
    if (valuation >= tier.valuation) reachedTiers += 1;
    else break;
  }
  return {
    reachedTiers,
    reachedTitle: reachedTiers > 0 ? OBJECTIVE_LADDER[reachedTiers - 1]!.title : null,
    next: OBJECTIVE_LADDER[reachedTiers] ?? null,
    valuation,
  };
}

export function getFirm(state: GameState, firmId: FirmId): Firm | undefined {
  return state.firms[firmId];
}

export function getPlayerFirm(state: GameState): Firm | undefined {
  return state.firms[state.playerFirmId];
}

export function firmFacilities(state: GameState, firmId: FirmId): Facility[] {
  const firm = state.firms[firmId];
  if (!firm) return [];
  return firm.facilities
    .map((id) => state.facilities[id])
    .filter((f): f is Facility => !!f);
}

export function firmEmployees(state: GameState, firmId: FirmId): Citizen[] {
  const firm = state.firms[firmId];
  if (!firm) return [];
  return firm.employees
    .map((id) => state.citizens[id])
    .filter((c): c is Citizen => !!c);
}

export function firmInventoryValue(state: GameState, firmId: FirmId): number {
  let value = 0;
  for (const fac of firmFacilities(state, firmId)) {
    for (const inv of [fac.inputInventory, fac.outputInventory]) {
      for (const pid in inv) value += inv[pid]!.quantity * getProduct(pid).basePrice;
    }
  }
  return value;
}

export interface FirmPnL {
  revenue: number;
  costOfGoodsSold: number;
  wages: number;
  maintenance: number;
  logisticsCost: number;
  variableProductionCost: number;
  marketing: number;
  rnd: number;
  interest: number;
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
}

function toPnL(p: import('../entities/Accounting').AccountingPeriod | null): FirmPnL {
  if (!p) {
    return {
      revenue: 0, costOfGoodsSold: 0, wages: 0, maintenance: 0, logisticsCost: 0,
      variableProductionCost: 0, marketing: 0, rnd: 0, interest: 0,
      grossProfit: 0, operatingProfit: 0, netProfit: 0,
    };
  }
  return {
    revenue: p.revenue,
    costOfGoodsSold: p.costOfGoodsSold,
    wages: p.wages,
    maintenance: p.maintenance,
    logisticsCost: p.logisticsCost,
    variableProductionCost: p.variableProductionCost,
    marketing: p.marketing,
    rnd: p.rnd,
    interest: p.interest,
    grossProfit: grossProfit(p),
    operatingProfit: operatingProfit(p),
    netProfit: netProfit(p),
  };
}

export function firmPnLToday(state: GameState, firmId: FirmId): FirmPnL {
  return toPnL(state.firms[firmId]?.accounting.today ?? null);
}

export function firmPnLLifetime(state: GameState, firmId: FirmId): FirmPnL {
  return toPnL(state.firms[firmId]?.accounting.lifetime ?? null);
}

/** Human-readable warnings for a firm (cash, distress, bottlenecks). */
export function firmWarnings(state: GameState, firmId: FirmId): string[] {
  const firm = state.firms[firmId];
  if (!firm) return [];
  const warnings: string[] = [];
  if (firm.cash < 0) warnings.push(`Cash is negative (${firm.cash}¢).`);
  if (firm.debt > 0) warnings.push(`Carrying ${firm.debt}¢ of debt.`);
  if (firm.bankruptcyStatus === 'distressed') warnings.push('Firm is distressed.');
  if (firm.bankruptcyStatus === 'insolvent') warnings.push('Firm is insolvent — facilities are closing.');
  for (const fac of firmFacilities(state, firmId)) {
    if (fac.status === 'input-starved' || fac.status === 'labor-starved' || fac.status === 'inventory-full') {
      warnings.push(`${fac.name}: ${fac.status}${fac.bottleneckReason ? ` (${fac.bottleneckReason})` : ''}.`);
    }
  }
  return warnings;
}

export interface Valuation {
  cash: number;
  inventoryValue: number;
  assetValue: number; // book value of built facilities
  debt: number;
  netWorth: number; // cash + inventory + assets − debt
  /** Enterprise value: net worth plus an earnings multiple on recent net profit. */
  valuation: number;
}

const EARNINGS_MULTIPLE = 30;

/**
 * Company valuation — net worth plus a P/E-style premium on recent daily net
 * profit. Profitable, well-capitalised firms are worth more, so growing
 * valuation (not just cash) is the scoreboard metric.
 */
export function companyValuation(state: GameState, firmId: FirmId): Valuation {
  const firm = state.firms[firmId];
  if (!firm) {
    return { cash: 0, inventoryValue: 0, assetValue: 0, debt: 0, netWorth: 0, valuation: 0 };
  }
  const inventoryValue = firmInventoryValue(state, firmId);
  let assetValue = 0;
  for (const fac of firmFacilities(state, firmId)) {
    if (fac.type === 'home' || fac.status === 'closed') continue;
    assetValue += fac.buildCost;
  }
  const netWorth = firm.cash + inventoryValue + assetValue - firm.debt;
  const recent = firm.accounting.dailyHistory.slice(-7);
  const avgNet = recent.length
    ? recent.reduce((s, d) => s + d.netProfit, 0) / recent.length
    : 0;
  const valuation = Math.round(netWorth + Math.max(0, avgNet) * EARNINGS_MULTIPLE);
  return { cash: firm.cash, inventoryValue, assetValue, debt: firm.debt, netWorth, valuation };
}

export interface RankEntry {
  firmId: FirmId;
  name: string;
  ownerType: Firm['ownerType'];
  valuation: number;
  netWorth: number;
  isPlayer: boolean;
}

/** Competitive standings of all real (player + AI) firms by valuation. */
export function rankings(state: GameState): RankEntry[] {
  const entries: RankEntry[] = [];
  for (const id in state.firms) {
    const f = state.firms[id]!;
    if (f.ownerType !== 'player' && f.ownerType !== 'ai') continue;
    const v = companyValuation(state, id);
    entries.push({
      firmId: id,
      name: f.name,
      ownerType: f.ownerType,
      valuation: v.valuation,
      netWorth: v.netWorth,
      isPlayer: id === state.playerFirmId,
    });
  }
  entries.sort((a, b) => b.valuation - a.valuation);
  return entries;
}

/** 1-based rank of the player firm by valuation. */
export function playerRank(state: GameState): { rank: number; total: number } {
  const r = rankings(state);
  const idx = r.findIndex((e) => e.isPlayer);
  return { rank: idx < 0 ? r.length : idx + 1, total: r.length };
}
