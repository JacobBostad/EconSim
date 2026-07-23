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
import { townOf } from '../core/Town';
import { grossProfit, operatingProfit, netProfit } from '../entities/Accounting';
import { getProduct } from '../data/products';
import { OBJECTIVE_LADDER, BOARD_VISIBILITY_PCT } from '../data/constants';

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
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  return townOf(state).firms[firmId];
}

export function getPlayerFirm(state: GameState): Firm | undefined {
  return townOf(state).firms[state.playerFirmId];
}

export function firmFacilities(state: GameState, firmId: FirmId): Facility[] {
  const firm = townOf(state).firms[firmId];
  if (!firm) return [];
  const facilities = townOf(state).facilities;
  return firm.facilities
    .map((id) => facilities[id])
    .filter((f): f is Facility => !!f);
}

export function firmEmployees(state: GameState, firmId: FirmId): Citizen[] {
  const firm = townOf(state).firms[firmId];
  if (!firm) return [];
  const citizens = townOf(state).citizens;
  return firm.employees
    .map((id) => citizens[id])
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
  serviceExpense: number;
  rentExpense: number;
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
      variableProductionCost: 0, serviceExpense: 0, rentExpense: 0, marketing: 0, rnd: 0, interest: 0,
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
    serviceExpense: p.serviceExpense ?? 0,
    rentExpense: p.rentExpense ?? 0,
    marketing: p.marketing,
    rnd: p.rnd,
    interest: p.interest,
    grossProfit: grossProfit(p),
    operatingProfit: operatingProfit(p),
    netProfit: netProfit(p),
  };
}

export function firmPnLToday(state: GameState, firmId: FirmId): FirmPnL {
  return toPnL(townOf(state).firms[firmId]?.accounting.today ?? null);
}

export function firmPnLLifetime(state: GameState, firmId: FirmId): FirmPnL {
  return toPnL(townOf(state).firms[firmId]?.accounting.lifetime ?? null);
}

/** Human-readable warnings for a firm (cash, distress, bottlenecks). */
export function firmWarnings(state: GameState, firmId: FirmId): string[] {
  const firm = townOf(state).firms[firmId];
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
  const firms = townOf(state).firms;
  for (const fid in firms) {
    if (fid === firmId) continue;
    const f = firms[fid]!;
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
  const hist = townOf(state).firms[firmId]?.accounting.dailyHistory;
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
  /** Stakes in other firms, marked to market (their marketCap × pct). */
  holdingsValue: number;
  debt: number;
  netWorth: number; // cash + inventory + assets + holdings − debt
  /** Net worth WITHOUT holdings — the collateral base for loans, so marked
   * stakes can never collateralize a leverage spiral. */
  operatingNetWorth: number;
  /** Enterprise value: net worth plus an earnings multiple on recent net profit. */
  valuation: number;
}

const EARNINGS_MULTIPLE = 30;

/**
 * P/E-style premium on the 7-day average daily net profit. Sustained losses
 * now discount the price below book — a firm burning cash is cheaper than a
 * break-even one — but never below half its positive net worth (the hard
 * assets still exist and would be recovered in liquidation).
 */
function earningsPremium(netWorth: number, avgNet: number): number {
  if (avgNet >= 0) return avgNet * EARNINGS_MULTIPLE;
  return Math.max(avgNet * EARNINGS_MULTIPLE, -Math.max(0, netWorth) / 2);
}

/**
 * Operating valuation — a firm priced on its OWN business only: cash +
 * inventory + facility book value − debt, plus the earnings premium. Held
 * stakes are excluded; this is the term other firms' marks are built from,
 * which keeps cross-holding valuation a closed form instead of a fixed point.
 */
export function operatingValuationOf(state: GameState, firmId: FirmId): number {
  const firm = townOf(state).firms[firmId];
  if (!firm) return 0;
  const inventoryValue = firmInventoryValue(state, firmId);
  let assetValue = 0;
  // The AI-pricing tier stays deliberately at BASE build cost — no apartments,
  // no upgrade capex (Phase 5 enriches only the scoreboard companyValuation).
  // This number flows into marketCap → the city AI's stake-yield decisions,
  // whose rng trajectory the A3 crowd/tier bands are pinned to; and it is the
  // Village bit-identity anchor. Both stay untouched by construction.
  for (const fac of firmFacilities(state, firmId)) {
    if (fac.type === 'home' || fac.status === 'closed') continue;
    assetValue += fac.buildCost;
  }
  const netWorth = firm.cash + inventoryValue + assetValue - firm.debt;
  const recent = firm.accounting.dailyHistory.slice(-7);
  const avgNet = recent.length
    ? recent.reduce((s, d) => s + d.netProfit, 0) / recent.length
    : 0;
  return Math.round(netWorth + earningsPremium(netWorth, avgNet));
}

/**
 * Market capitalization — what the whole firm trades at: its operating
 * valuation plus its stakes marked at the COUNTERPARTIES' operating
 * valuations (depth 1, deterministic). Share trades and buyouts price off
 * this, so buying a holding company buys its portfolio.
 */
export function marketCap(state: GameState, firmId: FirmId): number {
  const firm = townOf(state).firms[firmId];
  if (!firm) return 0;
  let holdings = 0;
  for (const tid of Object.keys(firm.sharesHeld).sort()) {
    const pct = firm.sharesHeld[tid] ?? 0;
    if (pct > 0) holdings += Math.round((pct * operatingValuationOf(state, tid)) / 100);
  }
  return operatingValuationOf(state, firmId) + holdings;
}

/**
 * Company valuation — net worth plus a P/E-style premium on recent daily net
 * profit, with held stakes marked at their current sale price (the target's
 * marketCap). Buying a stake at market therefore leaves the buyer's
 * valuation unchanged: cash out, an equal mark in. Growing valuation (not
 * just cash) is the scoreboard metric — and since dividends received now
 * count as net profit, a holding company's income stream earns the same
 * multiple as an operator's.
 */
export function companyValuation(state: GameState, firmId: FirmId): Valuation {
  const firm = townOf(state).firms[firmId];
  if (!firm) {
    return {
      cash: 0, inventoryValue: 0, assetValue: 0, holdingsValue: 0,
      debt: 0, netWorth: 0, operatingNetWorth: 0, valuation: 0,
    };
  }
  const inventoryValue = firmInventoryValue(state, firmId);
  let assetValue = 0;
  // Scoreboard book value (Phase 5 / Arc B3, city scale): apartments carry
  // their book value like any facility (building one no longer permanently
  // destroys its cost from the score, and it sells back — Demolition drops
  // 'home' from UNSELLABLE_TYPES), and upgrade capex (fac.upgradeCapex) is
  // added on top of base build cost. Both are gated off Village: this
  // valuation is written into the serialized DailySnapshot (AccountingSystem),
  // so enriching it in a Village would break the 300-day bit-identity baseline.
  // The AI-pricing tier (operatingValuationOf/marketCap) deliberately does NOT
  // see either enrichment, so the city AI's stake decisions — and the rng
  // trajectory the A3 crowd/tier bands are pinned to — are untouched.
  const enrich = state.config.sizePreset !== 'village';
  for (const fac of firmFacilities(state, firmId)) {
    if ((fac.type === 'home' && !enrich) || fac.status === 'closed') continue;
    assetValue += fac.buildCost + (enrich ? (fac.upgradeCapex ?? 0) : 0);
  }
  let holdingsValue = 0;
  for (const tid of Object.keys(firm.sharesHeld).sort()) {
    const pct = firm.sharesHeld[tid] ?? 0;
    if (pct > 0) holdingsValue += Math.round((pct * marketCap(state, tid)) / 100);
  }
  const operatingNetWorth = firm.cash + inventoryValue + assetValue - firm.debt;
  const netWorth = operatingNetWorth + holdingsValue;
  const recent = firm.accounting.dailyHistory.slice(-7);
  const avgNet = recent.length
    ? recent.reduce((s, d) => s + d.netProfit, 0) / recent.length
    : 0;
  const valuation = Math.round(netWorth + earningsPremium(netWorth, avgNet));
  return {
    cash: firm.cash, inventoryValue, assetValue, holdingsValue,
    debt: firm.debt, netWorth, operatingNetWorth, valuation,
  };
}

/** A significant holder's window into a firm it part-owns (control ladder). */
export interface BoardView {
  cash: number;
  /** 7-day average daily net profit — the same smoothed figure the dashboard
   * and dividend policy use, not a single noisy day. */
  netProfit7d: number;
  facilities: number;
}

/**
 * Board visibility (Phase 3 control ladder): a firm holding at least
 * BOARD_VISIBILITY_PCT of a target sees its books — cash, smoothed net profit,
 * and facility count. Returns null below the threshold or for a missing firm,
 * so the UI can gate the panel on a non-null result. Pure metadata; moves no
 * money and grants no control (the 40% block is separate).
 */
export function boardVisibility(
  state: GameState,
  holderId: FirmId,
  targetId: FirmId,
): BoardView | null {
  const firms = townOf(state).firms;
  const holder = firms[holderId];
  const target = firms[targetId];
  if (!holder || !target) return null;
  if ((holder.sharesHeld[targetId] ?? 0) < BOARD_VISIBILITY_PCT) return null;
  const recent = target.accounting.dailyHistory.slice(-7);
  const netProfit7d = recent.length
    ? Math.round(recent.reduce((s, d) => s + d.netProfit, 0) / recent.length)
    : 0;
  return {
    cash: target.cash,
    netProfit7d,
    facilities: target.facilities.length,
  };
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
  const firm = townOf(state).firms[firmId];
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
  const firms = townOf(state).firms;
  for (const id in firms) {
    const f = firms[id]!;
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
