/**
 * wholesaleSelectors.ts — the wholesale board: who is selling what, at what
 * asking price, against the importer's benchmark. Makes the price war
 * legible — undercut the cheapest row and the next AI sourcing pass is yours.
 */

import type { GameState } from '../core/GameState';
import { wholesaleUnitPrice, localSurplus } from '../core/Wholesale';
import { WHOLESALE_DISCOUNT, IMPORT_MARKUP } from '../data/constants';
import { getProduct } from '../data/products';
import { worldImportMult } from '../data/worldEvents';
import { townOf } from '../core/Town';

export interface WholesaleRow {
  facilityId: string;
  facilityName: string;
  firmName: string;
  isPlayer: boolean;
  /** Asking price as fraction of market average. */
  mult: number;
  /** Cents per unit at today's market average. */
  unitPrice: number;
  /** Units on offer after the seller's own chains are served. */
  surplus: number;
  /** Active cross-firm contracts sourcing from this facility. */
  customers: number;
}

export interface WholesaleProduct {
  productId: string;
  productName: string;
  /** What buying from the importer costs per unit today (the bar to beat). */
  importerUnit: number;
  rows: WholesaleRow[];
}

/** Products with at least one wholesale seller (surplus or active customers),
 * suppliers sorted cheapest-first. */
export function wholesaleBoard(state: GameState): WholesaleProduct[] {
  const byProduct = new Map<string, WholesaleRow[]>();

  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const firms = townOf(state).firms;
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.type === 'importer' || fac.type === 'warehouse' || fac.type === 'home') continue;
    if (fac.type === 'retail' || fac.status === 'closed' || fac.wholesaleEnabled === false) continue;
    const firm = firms[fac.ownerFirmId];
    if (!firm || firm.ownerType === 'world') continue;

    const pids = new Set<string>(Object.keys(fac.outputInventory));
    for (const cid in state.contracts) {
      const c = state.contracts[cid]!;
      if (c.active && c.sourceFacilityId === fac.id) pids.add(c.productId);
    }
    for (const pid of pids) {
      const surplus = localSurplus(state, fac, pid);
      let customers = 0;
      for (const cid in state.contracts) {
        const c = state.contracts[cid]!;
        if (!c.active || c.sourceFacilityId !== fac.id || c.productId !== pid) continue;
        if (state.facilities[c.destinationFacilityId]?.ownerFirmId !== fac.ownerFirmId) customers++;
      }
      if (surplus <= 0 && customers === 0) continue;
      const rows = byProduct.get(pid) ?? [];
      rows.push({
        facilityId: fac.id,
        facilityName: fac.name,
        firmName: firm.name,
        isPlayer: fac.ownerFirmId === state.playerFirmId,
        mult: fac.wholesalePriceMult ?? WHOLESALE_DISCOUNT,
        unitPrice: wholesaleUnitPrice(state, fac, pid),
        surplus,
        customers,
      });
      byProduct.set(pid, rows);
    }
  }

  const out: WholesaleProduct[] = [];
  for (const [pid, rows] of byProduct) {
    rows.sort((a, b) => a.unitPrice - b.unitPrice || b.surplus - a.surplus);
    out.push({
      productId: pid,
      productName: getProduct(pid).name,
      importerUnit: Math.round(getProduct(pid).basePrice * IMPORT_MARKUP * worldImportMult(state)),
      rows,
    });
  }
  out.sort((a, b) => a.productName.localeCompare(b.productName));
  return out;
}
