/**
 * debugSelectors — engine introspection for the Debug dashboard.
 */

import type { GameState } from '../core/GameState';
import { totalMoneySupply } from '../core/GameState';
import type { Transaction } from '../core/Transactions';
import { computeTime } from '../core/Tick';
import { ALL_PRODUCT_IDS } from '../data/products';
import { getQuantity } from '../entities/Inventory';

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
  const productQuantities: Record<string, number> = {};
  for (const pid of ALL_PRODUCT_IDS) productQuantities[pid] = 0;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    for (const pid of ALL_PRODUCT_IDS) {
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
    citizenCount: Object.keys(state.citizens).length,
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
