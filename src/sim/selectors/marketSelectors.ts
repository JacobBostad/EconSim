/**
 * marketSelectors — per-product market views for the Market dashboard.
 */

import type { GameState } from '../core/GameState';
import type { MarketStat } from '../entities/Market';
import type { ProductId } from '../core/Id';
import { ALL_PRODUCT_IDS, CONSUMER_PRODUCT_IDS, getProduct } from '../data/products';

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
  return state.marketStats[productId];
}

export function marketRows(state: GameState, consumerOnly = true): MarketRow[] {
  const ids = consumerOnly ? CONSUMER_PRODUCT_IDS : ALL_PRODUCT_IDS;
  return ids.map((pid) => {
    const stat = state.marketStats[pid]!;
    const product = getProduct(pid);
    let topFirm = '';
    let topShare = 0;
    for (const fid in stat.marketShareByFirm) {
      const share = stat.marketShareByFirm[fid]!;
      if (share > topShare) {
        topShare = share;
        topFirm = state.firms[fid]?.name ?? fid;
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
