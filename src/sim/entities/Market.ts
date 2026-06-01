/**
 * Market.ts — Per-product market statistics.
 *
 * Aggregated each day by MarketStatsSystem from the day's sale attempts and the
 * current economy-wide inventory. Drives the Market dashboard and the AI's sense
 * of price levels and market share.
 */

import type { ProductId, FirmId } from '../core/Id';

export interface MarketStat {
  productId: ProductId;
  /** Total purchase attempts today (whether or not fulfilled). */
  demandAttempts: number;
  fulfilledDemand: number;
  unmetDemand: number;
  unitsSold: number;
  /** Cents. */
  averagePrice: number;
  lowestPrice: number;
  highestPrice: number;
  averageQuality: number;
  stockoutCount: number;
  totalInventory: number;
  /** firmId -> units sold today, used to derive market share. */
  unitsSoldByFirm: Record<FirmId, number>;
  marketShareByFirm: Record<FirmId, number>;
  /** Accumulators reset each day; revenue is used to compute averagePrice. */
  revenueAccum: number;
  qualityAccum: number;
}

export function emptyMarketStat(productId: ProductId): MarketStat {
  return {
    productId,
    demandAttempts: 0,
    fulfilledDemand: 0,
    unmetDemand: 0,
    unitsSold: 0,
    averagePrice: 0,
    lowestPrice: 0,
    highestPrice: 0,
    averageQuality: 0,
    stockoutCount: 0,
    totalInventory: 0,
    unitsSoldByFirm: {},
    marketShareByFirm: {},
    revenueAccum: 0,
    qualityAccum: 0,
  };
}
