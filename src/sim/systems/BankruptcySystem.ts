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
import { tradeShares } from '../core/Shares';
import { fireCitizen } from './LaborSystem';

export function runBankruptcySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, config } = ctx;

  // Arc B2 (city-scale only): a distressed AI liquidates its portfolio before
  // shuttering facilities — stakes are its most liquid asset, and a real
  // operator sells them first. Gated to keep the Village bankruptcy path
  // bit-identical; the player's portfolio is never force-sold (its owner
  // decides). Village AI rarely holds equity anyway, but the gate makes the
  // baseline invariance structural, not empirical.
  const cityScale = state.config.sizePreset !== 'village';

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

    // Liquid assets first: a troubled AI sells its stakes at market before any
    // facility is touched (city-scale only — see the gate above).
    const sellPortfolio = cityScale && firm.ownerType === 'ai';

    if (firm.daysInsolvent >= config.insolvencyCloseDays) {
      firm.bankruptcyStatus = 'insolvent';
      // Sell the portfolio first; only shutter a facility if that still leaves
      // the firm underwater. Selling can lift cash back to solvent — a genuine
      // reprieve, exactly what liquidating a rival stake buys a real operator.
      if (sellPortfolio) liquidatePortfolio(ctx, firm.id);
      if (firm.cash < 0) closeCostliestFacility(ctx, firm.id);
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
      if (sellPortfolio) liquidatePortfolio(ctx, firm.id);
    }
  }
}

/**
 * Sell every stake the firm holds, at market, in sorted order (determinism).
 * Each sale runs the full tradeShares path — 3% fee, price impact, realized
 * P&L against cost basis, money conserved. Returns true if anything sold.
 */
function liquidatePortfolio(ctx: SimContext, firmId: string): boolean {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const targets = Object.keys(firm.sharesHeld).sort();
  if (targets.length === 0) return false;
  emitEvent(
    state,
    'warning',
    'finance',
    `${firm.name} is selling its share portfolio to raise cash.`,
    firm.id,
  );
  let sold = false;
  for (const tid of targets) {
    const pct = firm.sharesHeld[tid] ?? 0;
    if (pct <= 0) continue;
    if (tradeShares(state, firmId, tid, -pct)) sold = true;
  }
  return sold;
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
