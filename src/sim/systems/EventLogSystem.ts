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
import { formatMoney } from '../../utils/formatMoney';
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

    // Daily production digest from yesterday's stats (EventLog runs before the
    // accounting reset). Instantaneous status is useless here: this pass runs
    // at midnight, when every facility is off-shift.
    // A full output buffer is a saturation signal, not a failure — even when
    // it idled the facility all day. The harsh "produced nothing" alarm is
    // reserved for real starvation (missing inputs, no workers).
    if (fac.dailyStats.bottleneck === 'Output storage full') {
      emitEvent(
        state, 'info', 'production',
        `${fac.name} is producing more than you sell — it pauses until stock moves. Sell the surplus wholesale, export from a warehouse, or grow your store's sales.`,
        fac.id,
      );
    } else if (fac.activeRecipeId && fac.dailyStats.ticksActive === 0 && fac.dailyStats.bottleneck) {
      emitEvent(
        state, 'warning', 'production',
        `${fac.name} produced nothing yesterday — ${fac.dailyStats.bottleneck}.`,
        fac.id,
      );
    }

    for (const pid of fac.type === 'retail' ? fac.retailProductIds : []) {
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
      `Your firm ran an operating loss of ${formatMoney(Math.abs(op))} today — wages/costs exceed margin.`,
      player.id,
    );
  }
}
