/**
 * MarketStatsSystem — aggregates per-product market statistics.
 *
 * - Hourly: recompute economy-wide inventory totals (cheap, keeps dashboards
 *   fresh without scanning every facility each tick).
 * - Daily (at the day boundary, before the AI and accounting roll-ups): finalize
 *   average price/quality and market share from the day's accumulators, push
 *   per-firm shares onto firms, then reset the daily accumulators.
 *
 * RetailDemandSystem feeds the raw accumulators during the day.
 */

import type { SimContext } from '../core/GameState';
import { townOf } from '../core/Town';
import { isDayBoundary, isHourBoundary } from '../core/Tick';
import { safeDiv } from '../../utils/math';
import { getQuantity } from '../entities/Inventory';
import { pickBestCity } from '../core/Trade';

export function runMarketStatsSystem(ctx: SimContext): void {
  if (isHourBoundary(ctx.state.tick, ctx.config)) computeInventoryTotals(ctx);
  if (isDayBoundary(ctx.state.tick, ctx.config)) finalizeAndReset(ctx);
}

function computeInventoryTotals(ctx: SimContext): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  // Iterate THIS town's own market book, not PRODUCT_IDS_BY_PRESET[host preset].
  // Home's book is seeded with exactly PRODUCT_IDS_BY_PRESET[home preset] (same
  // set, same insertion order), so home is byte-identical; but a PARTNER town
  // (region.md step 4) carries its OWN preset (PORT_ROSA_SPEC is city-sized,
  // fixed) independent of the host — so at a Metropolis host the host superset
  // would name products the city-sized partner book has no entry for and this
  // write would throw. Keying off the town's own book makes the partner correct
  // at every host preset. This system draws no rng and moves no money, so the
  // set — not the order — is what matters (determinism is untouched).
  const ids = Object.keys(town.marketStats);
  const totals: Record<string, number> = {};
  for (const pid of ids) totals[pid] = 0;
  for (const fid in town.facilities) {
    const fac = town.facilities[fid]!;
    if (fac.type === 'importer') continue; // exclude the infinite buffer
    for (const pid of ids) {
      totals[pid]! +=
        getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid);
    }
  }
  for (const pid of ids) {
    town.marketStats[pid]!.totalInventory = totals[pid]!;
  }
}

function finalizeAndReset(ctx: SimContext): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  // The town's own book (see computeInventoryTotals) — byte-identical for home,
  // correct for a partner whose preset differs from the host's.
  for (const pid of Object.keys(town.marketStats)) {
    const stat = town.marketStats[pid]!;
    stat.averagePrice = Math.round(safeDiv(stat.revenueAccum, stat.unitsSold, 0));
    stat.averageQuality = safeDiv(stat.qualityAccum, stat.unitsSold, 0);

    // Market share by firm (by units sold today).
    let totalSold = 0;
    for (const fid in stat.unitsSoldByFirm) totalSold += stat.unitsSoldByFirm[fid]!;
    const shares: Record<string, number> = {};
    for (const fid in stat.unitsSoldByFirm) {
      shares[fid] = safeDiv(stat.unitsSoldByFirm[fid]!, totalSold, 0);
    }
    stat.marketShareByFirm = shares;
    for (const fid in shares) {
      const firm = town.firms[fid];
      if (firm) firm.marketShareByProduct[pid] = shares[fid]!;
    }

    // Keep a bounded per-day history for trend charts.
    stat.history.push({
      day: ctx.time.day - 1,
      averagePrice: stat.averagePrice,
      unitsSold: stat.unitsSold,
      unmetDemand: stat.unmetDemand,
      totalInventory: stat.totalInventory,
      sharesByFirm: { ...shares },
      // Chart the best-paying city's quote (the price an exporter would take).
      tradePrice: pickBestCity(state, pid).price,
    });
    if (stat.history.length > state.config.maxDailyHistory) {
      stat.history.splice(0, stat.history.length - state.config.maxDailyHistory);
    }

    // Reset daily accumulators for the new day.
    stat.demandAttempts = 0;
    stat.fulfilledDemand = 0;
    stat.unmetDemand = 0;
    stat.unitsSold = 0;
    stat.stockoutCount = 0;
    stat.revenueAccum = 0;
    stat.qualityAccum = 0;
    stat.lowestPrice = 0;
    stat.highestPrice = 0;
    stat.unitsSoldByFirm = {};
  }
}
