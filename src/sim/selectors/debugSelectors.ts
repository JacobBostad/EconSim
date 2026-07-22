/**
 * debugSelectors — engine introspection for the Debug dashboard.
 */

import type { GameState } from '../core/GameState';
import { totalMoneySupply } from '../core/GameState';
import type { Transaction } from '../core/Transactions';
import { computeTime } from '../core/Tick';
import { PRODUCT_IDS_BY_PRESET, CONSUMER_PRODUCT_IDS_BY_PRESET, getProduct } from '../data/products';
import { getQuantity } from '../entities/Inventory';
import { townOf } from '../core/Town';

export interface DebugSnapshot {
  tick: number;
  seed: number;
  day: number;
  hour: number;
  rngState: number;
  totalMoneySupply: number;
  worldCash: number;
  citizenCount: number;
  firmCount: number;
  facilityCount: number;
  activeShipments: number;
  contractCount: number;
  productQuantities: Record<string, number>;
  avgTickMs: number;
  lastTickMs: number;
}

export function debugSnapshot(state: GameState): DebugSnapshot {
  const time = computeTime(state.tick, state.config);
  const productIds = PRODUCT_IDS_BY_PRESET[state.config.sizePreset];
  const productQuantities: Record<string, number> = {};
  for (const pid of productIds) productQuantities[pid] = 0;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    for (const pid of productIds) {
      productQuantities[pid]! += getQuantity(f.inputInventory, pid) + getQuantity(f.outputInventory, pid);
    }
  }
  let active = 0;
  for (const vid in state.vehicles) if (state.vehicles[vid]!.status === 'enroute') active++;

  return {
    tick: state.tick,
    seed: state.seed,
    day: time.day,
    hour: time.hour,
    rngState: state.rngState,
    totalMoneySupply: totalMoneySupply(state),
    worldCash: state.worldCash,
    citizenCount: Object.keys(townOf(state).citizens).length,
    firmCount: Object.keys(state.firms).length,
    facilityCount: Object.keys(state.facilities).length,
    activeShipments: active,
    contractCount: Object.keys(state.contracts).length,
    productQuantities,
    avgTickMs: state.perf.avgTickMs,
    lastTickMs: state.perf.lastTickMs,
  };
}

export function recentTransactions(state: GameState, limit = 30): Transaction[] {
  const txns = state.transactions;
  return txns.slice(Math.max(0, txns.length - limit)).reverse();
}

export interface MacroIndicators {
  /** Consumer price index: avg of (avg price / base price) across goods, ×100. */
  priceIndex: number;
  /** Consumer spend recorded so far today (cents). */
  consumerSpendToday: number;
  /** Units sold to citizens today (trade volume). */
  unitsSoldToday: number;
  /** Unmet demand today (shortage pressure). */
  unmetDemandToday: number;
  /** Total inventory of consumer goods across the economy. */
  goodsInventory: number;
  activeFirms: number;
}

/** Live, transparent macro indicators derived from current state. */
export function macroIndicators(state: GameState): MacroIndicators {
  let idxSum = 0, idxN = 0, spend = 0, sold = 0, unmet = 0, inv = 0;
  const marketStats = townOf(state).marketStats;
  for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
    const stat = marketStats[pid];
    if (!stat) continue;
    const base = getProduct(pid).basePrice;
    if (stat.averagePrice > 0 && base > 0) { idxSum += stat.averagePrice / base; idxN++; }
    spend += stat.revenueAccum;
    sold += stat.unitsSold;
    unmet += stat.unmetDemand;
    inv += stat.totalInventory;
  }
  let activeFirms = 0;
  for (const id in state.firms) {
    const f = state.firms[id]!;
    if ((f.ownerType === 'player' || f.ownerType === 'ai') && f.bankruptcyStatus !== 'insolvent') activeFirms++;
  }
  return {
    priceIndex: idxN ? (idxSum / idxN) * 100 : 100,
    consumerSpendToday: spend,
    unitsSoldToday: sold,
    unmetDemandToday: unmet,
    goodsInventory: inv,
    activeFirms,
  };
}
