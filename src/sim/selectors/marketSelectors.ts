/**
 * marketSelectors — per-product market views for the Market dashboard.
 */

import type { GameState } from '../core/GameState';
import type { MarketStat } from '../entities/Market';
import type { ProductId } from '../core/Id';
import { PRODUCT_IDS_BY_PRESET, CONSUMER_PRODUCT_IDS_BY_PRESET, getProduct } from '../data/products';
import { crowdCount } from '../entities/Facility';
import { townOf } from '../core/Town';

export interface MarketRow {
  productId: ProductId;
  name: string;
  basePrice: number;
  averagePrice: number;
  demandAttempts: number;
  fulfilledDemand: number;
  unmetDemand: number;
  unitsSold: number;
  stockoutCount: number;
  averageQuality: number;
  totalInventory: number;
  topFirmName: string;
  topFirmShare: number;
}

export function marketStat(state: GameState, productId: ProductId): MarketStat | undefined {
  // Bare-`state` selector mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  return townOf(state).marketStats[productId];
}

export function marketRows(state: GameState, consumerOnly = true): MarketRow[] {
  const ids = consumerOnly
    ? CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset]
    : PRODUCT_IDS_BY_PRESET[state.config.sizePreset];
  const marketStats = townOf(state).marketStats;
  const firms = townOf(state).firms;
  return ids.map((pid) => {
    const stat = marketStats[pid]!;
    const product = getProduct(pid);
    let topFirm = '';
    let topShare = 0;
    for (const fid in stat.marketShareByFirm) {
      const share = stat.marketShareByFirm[fid]!;
      if (share > topShare) {
        topShare = share;
        topFirm = firms[fid]?.name ?? fid;
      }
    }
    return {
      productId: pid,
      name: product.name,
      basePrice: product.basePrice,
      averagePrice: stat.averagePrice,
      demandAttempts: stat.demandAttempts,
      fulfilledDemand: stat.fulfilledDemand,
      unmetDemand: stat.unmetDemand,
      unitsSold: stat.unitsSold,
      stockoutCount: stat.stockoutCount,
      averageQuality: stat.averageQuality,
      totalInventory: stat.totalInventory,
      topFirmName: topFirm,
      topFirmShare: topShare,
    };
  });
}


// ---------------------------------------------------------------------------
// Pricing insight (store inspector)
// ---------------------------------------------------------------------------

import { REFERENCE_QUALITY } from '../data/constants';

export interface PricingInsight {
  yourPrice: number;
  marketAvgPrice: number;
  basePrice: number;
  /** Typical willingness-to-pay band across citizens (cents). */
  wtpLow: number;
  wtpHigh: number;
  /** Competing staffed stores selling the product (excluding this firm's). */
  competitors: number;
  yourShare: number;
}

/**
 * What citizens will actually pay for this firm's product, given its brand
 * and stock quality (mirrors the willingness formula in RetailDemandSystem).
 */
export function pricingInsight(
  state: GameState,
  firmId: string,
  productId: string,
): PricingInsight {
  const firm = townOf(state).firms[firmId];
  const product = getProduct(productId);
  const brand = firm?.brandByProduct[productId] ?? 0;
  const quality = firm?.qualityByProduct[productId] ?? product.defaultQuality;
  const premium = 1 + brand / 250 + (quality - REFERENCE_QUALITY) / 300;

  // Citizens' maxAffordablePriceMultiplier spans roughly 1.1–1.8 by product;
  // read the live range from the population for honesty.
  let lo = Infinity;
  let hi = 0;
  const citizens = townOf(state).citizens;
  for (const cid in citizens) {
    const need = citizens[cid]!.needs.find((n) => n.productId === productId);
    if (!need) continue;
    lo = Math.min(lo, need.maxAffordablePriceMultiplier);
    hi = Math.max(hi, need.maxAffordablePriceMultiplier);
  }
  if (!isFinite(lo)) { lo = 1.2; hi = 1.6; }

  let competitors = 0;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.retailProductIds.includes(productId) && f.ownerFirmId !== firmId &&
        f.status !== 'closed' && (f.employees.length > 0 || crowdCount(f) > 0)) {
      competitors++;
    }
  }

  return {
    yourPrice: firm?.pricesByProduct[productId] ?? product.basePrice,
    marketAvgPrice: townOf(state).marketStats[productId]?.averagePrice ?? 0,
    basePrice: product.basePrice,
    wtpLow: Math.round(product.basePrice * lo * premium),
    wtpHigh: Math.round(product.basePrice * hi * premium),
    competitors,
    yourShare: firm?.marketShareByProduct[productId] ?? 0,
  };
}
