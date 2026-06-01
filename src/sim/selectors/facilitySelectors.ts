/**
 * facilitySelectors — facility-centric derived views + indexes.
 */

import type { GameState } from '../core/GameState';
import type { Facility } from '../entities/Facility';
import type { Citizen } from '../entities/Citizen';
import type { FacilityId, FirmId, ProductId } from '../core/Id';

export function getFacility(state: GameState, id: FacilityId): Facility | undefined {
  return state.facilities[id];
}

export function facilitiesByFirm(state: GameState, firmId: FirmId): Facility[] {
  const out: Facility[] = [];
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    if (f.ownerFirmId === firmId) out.push(f);
  }
  return out;
}

export function facilitiesSellingProduct(state: GameState, productId: ProductId): Facility[] {
  const out: Facility[] = [];
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    if (f.type === 'retail' && f.retailProductId === productId) out.push(f);
  }
  return out;
}

export function facilityEmployees(state: GameState, id: FacilityId): Citizen[] {
  const fac = state.facilities[id];
  if (!fac) return [];
  return fac.employees.map((c) => state.citizens[c]).filter((c): c is Citizen => !!c);
}

/** Approximate daily profit contribution of a facility (revenue - direct costs). */
export function facilityProfitContribution(state: GameState, id: FacilityId): number {
  const fac = state.facilities[id];
  if (!fac) return 0;
  const wages = fac.employees.reduce((s, cid) => s + (state.citizens[cid]?.wage ?? 0), 0);
  return fac.dailyStats.revenue - fac.dailyStats.variableCost - fac.operatingCostPerDay - wages;
}

export function buildableLand(state: GameState): Facility[] {
  // No explicit empty-lot entities in v1; the whole map is buildable. This
  // returns existing facilities so the UI can avoid overlaps.
  return Object.values(state.facilities);
}
