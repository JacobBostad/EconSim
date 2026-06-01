/**
 * BankruptcySystem — monitors firm solvency once per day.
 *
 * A firm whose cash stays negative past the grace period becomes 'distressed'
 * (it slashes prices to liquidate stock and stops expanding). If it stays
 * insolvent long enough it becomes 'insolvent' and begins closing its costliest
 * facilities to cut losses. The player firm is never deleted — it only receives
 * escalating warnings and the same automatic cost-cutting, leaving room to
 * recover. Returning to non-negative cash restores 'healthy' status.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { getProduct } from '../data/products';
import { fireCitizen } from './LaborSystem';

export function runBankruptcySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, config } = ctx;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'player' && firm.ownerType !== 'ai') continue;

    if (firm.cash >= 0) {
      if (firm.bankruptcyStatus !== 'healthy') {
        emitEvent(
          state,
          'success',
          'finance',
          `${firm.name} has recovered to solvency.`,
          firm.id,
        );
      }
      firm.daysInsolvent = 0;
      firm.bankruptcyStatus = 'healthy';
      continue;
    }

    firm.daysInsolvent += 1;

    if (firm.daysInsolvent >= config.insolvencyCloseDays) {
      firm.bankruptcyStatus = 'insolvent';
      closeCostliestFacility(ctx, firm.id);
    } else if (firm.daysInsolvent >= config.distressGraceDays) {
      if (firm.bankruptcyStatus !== 'distressed') {
        emitEvent(
          state,
          'danger',
          'finance',
          `${firm.name} is distressed (cash ${firm.cash}). Cutting prices to liquidate.`,
          firm.id,
        );
      }
      firm.bankruptcyStatus = 'distressed';
      liquidate(ctx, firm.id);
    }
  }
}

function liquidate(ctx: SimContext, firmId: string): void {
  const firm = ctx.state.firms[firmId]!;
  for (const pid in firm.pricesByProduct) {
    const base = getProduct(pid).basePrice;
    firm.pricesByProduct[pid] = Math.max(
      Math.round(base * 0.7),
      Math.round((firm.pricesByProduct[pid] ?? base) * 0.95),
    );
  }
}

function closeCostliestFacility(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  let target: string | null = null;
  let worst = -1;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    if (fac.operatingCostPerDay > worst) {
      worst = fac.operatingCostPerDay;
      target = facId;
    }
  }
  if (!target) return;
  const fac = state.facilities[target]!;
  for (const cid of [...fac.employees]) fireCitizen(state, target, cid);
  fac.status = 'closed';
  fac.bottleneckReason = 'Closed (insolvency cost-cutting)';
  fac.activeRecipeId = fac.type === 'retail' ? fac.activeRecipeId : null;
  emitEvent(
    state,
    'danger',
    'finance',
    `${firm.name} closed ${fac.name} to cut losses.`,
    firm.id,
  );
}
