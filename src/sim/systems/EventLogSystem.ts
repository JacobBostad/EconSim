/**
 * EventLogSystem — generates player-facing operational feedback.
 *
 * Once per day it inspects the player's firm and emits concise, actionable
 * alerts: input/labor starvation, full output storage, retail stockouts,
 * prices far above the market, unprofitable operations, and unmet demand with
 * no supply contract feeding a store. These are the "why is this happening?"
 * messages that make the economy legible. (Events themselves are bounded by the
 * emit helper.)
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { operatingProfit } from '../entities/Accounting';
import { getProduct } from '../data/products';

export function runEventLogSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const player = state.firms[state.playerFirmId];
  if (!player) return;

  for (const facId of player.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;

    if (fac.status === 'input-starved' && fac.bottleneckReason) {
      emitEvent(state, 'warning', 'production', `${fac.name}: ${fac.bottleneckReason}.`, fac.id);
    }
    if (fac.status === 'labor-starved') {
      emitEvent(state, 'warning', 'production', `${fac.name} has no workers present.`, fac.id);
    }
    if (fac.status === 'inventory-full') {
      emitEvent(state, 'warning', 'production', `${fac.name}: workers idle — output storage is full.`, fac.id);
    }

    if (fac.type === 'retail' && fac.retailProductId) {
      const pid = fac.retailProductId;
      const product = getProduct(pid);
      if (fac.dailyStats.lostSales > 0) {
        emitEvent(
          state,
          'warning',
          'retail',
          `${fac.name} lost ${fac.dailyStats.lostSales} ${product.name} sales to stockouts today.`,
          fac.id,
        );
      }
      const price = player.pricesByProduct[pid] ?? product.basePrice;
      const avg = state.marketStats[pid]!.averagePrice;
      if (avg > 0 && price > avg * 1.2) {
        const pct = Math.round(((price - avg) / avg) * 100);
        emitEvent(
          state,
          'info',
          'retail',
          `${product.name} priced ${pct}% above the market average.`,
          fac.id,
        );
      }
      // Unmet demand with no inbound supply contract.
      const hasContract = Object.values(state.contracts).some(
        (c) => c.active && c.destinationFacilityId === fac.id && c.productId === pid,
      );
      if (!hasContract) {
        emitEvent(
          state,
          'warning',
          'logistics',
          `${fac.name} has no supply contract feeding it ${product.name}.`,
          fac.id,
        );
      }
    }
  }

  const op = operatingProfit(player.accounting.today);
  if (player.accounting.today.revenue > 0 && op < 0) {
    emitEvent(
      state,
      'danger',
      'finance',
      `Your firm ran an operating loss of ${Math.abs(op)}¢ today — wages/costs exceed margin.`,
      player.id,
    );
  }
}
