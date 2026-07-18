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
import { WHOLESALE_DISCOUNT } from '../data/constants';
import { getProduct } from '../data/products';

export const WHOLESALE_MULT_MIN = 0.5;
export const WHOLESALE_MULT_MAX = 1.0;

/** Per-unit price a buyer pays this seller for this product, cents. */
export function wholesaleUnitPrice(state: GameState, source: Facility, productId: string): number {
  const product = getProduct(productId);
  const stat = state.marketStats[productId];
  const base = stat && stat.averagePrice > 0 ? stat.averagePrice : product.basePrice;
  const mult = source.wholesalePriceMult ?? WHOLESALE_DISCOUNT;
  return Math.round(base * mult);
}
