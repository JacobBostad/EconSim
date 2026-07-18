/**
 * companySelectors — derived views of a firm for dashboards/inspectors.
 * Pure functions over GameState; safe to memoize in the UI.
 */

import type { GameState } from '../core/GameState';
import { formatMoney } from '../../utils/formatMoney';
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
  if (firm.cash < 0) warnings.push(`Cash is negative (${formatMoney(firm.cash)}).`);
  if (firm.debt > 0) warnings.push(`Carrying ${formatMoney(firm.debt)} of debt.`);
  if (firm.bankruptcyStatus === 'distressed') warnings.push('Firm is distressed.');
  if (firm.bankruptcyStatus === 'insolvent') warnings.push('Firm is insolvent — facilities are closing.');
  for (const fac of firmFacilities(state, firmId)) {
    if (fac.status === 'input-starved' || fac.status === 'labor-starved' || fac.status === 'inventory-full') {
      warnings.push(`${fac.name}: ${fac.status}${fac.bottleneckReason ? ` (${fac.bottleneckReason})` : ''}.`);
    }
  }
  return warnings;
}

/** Highest base wage any OTHER player/AI firm pays — the poaching bar. */
export function rivalTopWage(state: GameState, firmId: FirmId): number {
  let top = 0;
  for (const fid in state.firms) {
    if (fid === firmId) continue;
    const f = state.firms[fid]!;
    if (f.ownerType !== 'player' && f.ownerType !== 'ai') continue;
    top = Math.max(top, f.wagePolicy.baseWage);
  }
  return top;
}

export interface DailyInsight {
  day: number;
  net: number;
  revenue: number;
  /** Largest cost bucket of the day. */
  topCostLabel: string;
  topCostAmount: number;
  /** Net change vs the day before (0 when only one day exists). */
  deltaVsPrior: number;
  /** Full cost breakdown for a tooltip, largest first, zero buckets omitted. */
  breakdown: { label: string; amount: number }[];
}

/**
 * One-line "why you made/lost money yesterday": the last closed day's net,
 * its dominant cost, and the trend vs the day before. Null until a full day
 * has been played.
 */
export function dailyInsight(state: GameState, firmId: FirmId): DailyInsight | null {
  const hist = state.firms[firmId]?.accounting.dailyHistory;
  if (!hist || hist.length === 0) return null;
  const d = hist[hist.length - 1]!;
  const prior = hist.length > 1 ? hist[hist.length - 2]! : null;
  const buckets: { label: string; amount: number }[] = [
    { label: 'wages', amount: d.wages },
    { label: 'goods', amount: d.costOfGoodsSold },
    { label: 'maintenance', amount: d.maintenance },
    { label: 'logistics', amount: d.logisticsCost },
    { label: 'production', amount: d.variableProductionCost },
    { label: 'marketing', amount: d.marketing },
    { label: 'R&D', amount: d.rnd },
    { label: 'interest', amount: d.interest },
  ]
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return {
    day: d.day,
    net: d.netProfit,
    revenue: d.revenue,
    topCostLabel: buckets[0]?.label ?? 'none',
    topCostAmount: buckets[0]?.amount ?? 0,
    deltaVsPrior: prior ? d.netProfit - prior.netProfit : 0,
    breakdown: buckets,
  };
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

export interface FacilityPnLRow {
  facilityId: string;
  name: string;
  type: string;
  status: string;
  staff: number;
  unitsSold: number;
  unitsProduced: number;
  revenue: number;
  cost: number; // wages + maintenance + variable production cost
  net: number;
  /** 7-day EMA of net (cents/day) — the stable ranking signal. */
  emaNet: number;
}

/**
 * Per-facility P&L for the last closed day. Cash revenue (retail sales, rent,
 * exports) comes from the facility's yesterday snapshot; internal shipments
 * are credited to the shipper and debited to the receiver at market price, so
 * producers show the value they created instead of reading as pure cost.
 * Wages (headcount × base wage) and maintenance are attributed per facility.
 * Firm-wide spends (marketing, R&D, interest, logistics) are not attributed,
 * so rows won't sum exactly to the company's net — this is a tool for finding
 * money pits, not an audit. Sorted best-first by the 7-day EMA (single days
 * flip-flop with ship/idle rhythms): the pit is the bottom row.
 */
export function facilityPnL(state: GameState, firmId: FirmId): FacilityPnLRow[] {
  const firm = state.firms[firmId];
  if (!firm) return [];
  const rows: FacilityPnLRow[] = [];
  for (const fac of firmFacilities(state, firmId)) {
    const y = fac.yesterdayStats;
    const wages = fac.employees.length * firm.wagePolicy.baseWage;
    const revenue = y.revenue + y.transferOutValue;
    const cost = wages + fac.operatingCostPerDay + y.variableCost + y.transferInValue;
    rows.push({
      facilityId: fac.id,
      name: fac.name,
      type: fac.type,
      status: fac.status,
      staff: fac.employees.length,
      unitsSold: y.unitsSold,
      unitsProduced: y.unitsProduced,
      revenue,
      cost,
      net: revenue - cost,
      emaNet: Math.round(fac.pnlEma.net),
    });
  }
  rows.sort((a, b) => b.emaNet - a.emaNet || b.net - a.net);
  return rows;
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
