/**
 * Wholesale.ts — what a wholesale shipment costs the buyer.
 *
 * Sellers set a price as a fraction of the market average (default the
 * classic 70%). Undercutting attracts AI buyers — they pick the cheapest
 * qualifying supplier and walk away from anyone priced above import parity —
 * so the multiplier is a real lever: low to lock in volume, high (up to
 * market price) to milk locked-in customers while it lasts.
 */

import type { GameState } from './GameState';
import type { Facility } from '../entities/Facility';
import type { ContractIndex } from './ContractIndex';
import { contractsBySource } from './ContractIndex';
import { WHOLESALE_DISCOUNT } from '../data/constants';
import { getProduct } from '../data/products';
import { townOf } from './Town';

export const WHOLESALE_MULT_MIN = 0.5;
export const WHOLESALE_MULT_MAX = 1.0;

/** Per-unit price a buyer pays this seller for this product, cents. */
export function wholesaleUnitPrice(state: GameState, source: Facility, productId: string): number {
  const product = getProduct(productId);
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const stat = townOf(state).marketStats[productId];
  const base = stat && stat.averagePrice > 0 ? stat.averagePrice : product.basePrice;
  const mult = source.wholesalePriceMult ?? WHOLESALE_DISCOUNT;
  return Math.round(base * mult);
}

/**
 * Units a facility can actually sell wholesale: output stock minus what its
 * own firm's supply contracts have spoken for. Sellers are never raided
 * below what their own chains reserve.
 */
export function localSurplus(
  state: GameState,
  fac: Facility,
  productId: string,
  index?: ContractIndex,
): number {
  let reserved = 0;
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const facilities = townOf(state).facilities;
  // Per-tick callers (the AI sourcing loop) pass the context's contract index
  // so this reserve sum is O(source-bucket), not O(all contracts) — the same
  // set of contracts, summed in the same order. Callers without an index (UI
  // selectors) fall back to the full scan.
  if (index) {
    for (const cid of contractsBySource(index, fac.id)) {
      const c = state.contracts[cid]!;
      if (!c.active || c.productId !== productId) continue;
      if (facilities[c.destinationFacilityId]?.ownerFirmId !== fac.ownerFirmId) continue;
      reserved += c.targetQuantity;
    }
  } else {
    for (const cid in state.contracts) {
      const c = state.contracts[cid]!;
      if (!c.active || c.sourceFacilityId !== fac.id || c.productId !== productId) continue;
      if (facilities[c.destinationFacilityId]?.ownerFirmId !== fac.ownerFirmId) continue;
      reserved += c.targetQuantity;
    }
  }
  return Math.max(0, (fac.outputInventory[productId]?.quantity ?? 0) - reserved);
}
