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
  if (firm.bankruptcyStatus === 'distressed') warnings.push('Firm is distressed.');
  if (firm.bankruptcyStatus === 'insolvent') warnings.push('Firm is insolvent — facilities are closing.');
  for (const fac of firmFacilities(state, firmId)) {
    if (fac.status === 'input-starved' || fac.status === 'labor-starved' || fac.status === 'inventory-full') {
      warnings.push(`${fac.name}: ${fac.status}${fac.bottleneckReason ? ` (${fac.bottleneckReason})` : ''}.`);
    }
  }
  return warnings;
}
