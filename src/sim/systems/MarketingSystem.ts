/**
 * MarketingSystem — advertising builds brand; brand fades without spend.
 *
 * Once per day each firm pays its per-product advertising budget to the world
 * account (a marketing operating expense) and gains brand points with
 * diminishing returns toward the cap. All brands also decay daily, so brand is a
 * stock that must be maintained — the classic Capitalism-Lab marketing loop.
 * Brand feeds retail demand and willingness-to-pay (see RetailDemandSystem).
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction, canAfford } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { clamp } from '../../utils/clamp';
import { CENTS } from '../data/constants';
import { AD_BRAND_GAIN_PER_DOLLAR, BRAND_DECAY_PER_DAY, MAX_BRAND } from '../data/constants';

export function runMarketingSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'player' && firm.ownerType !== 'ai') continue;

    // Decay all existing brand.
    for (const pid in firm.brandByProduct) {
      firm.brandByProduct[pid] = (firm.brandByProduct[pid] ?? 0) * (1 - BRAND_DECAY_PER_DAY);
    }

    // Spend ad budgets to build brand.
    for (const pid in firm.adBudgetByProduct) {
      const budget = firm.adBudgetByProduct[pid] ?? 0;
      if (budget <= 0) continue;
      if (!canAfford(state, firmAccount(firm.id), budget)) continue;
      recordTransaction(state, {
        from: firmAccount(firm.id),
        to: WORLD_ACCOUNT,
        amount: budget,
        firmId: firm.id,
        category: 'marketing',
        productId: pid,
        note: 'Advertising',
      });
      const cur = firm.brandByProduct[pid] ?? 0;
      const headroom = 1 - cur / MAX_BRAND;
      const gain = AD_BRAND_GAIN_PER_DOLLAR * (budget / CENTS) * headroom;
      firm.brandByProduct[pid] = clamp(cur + gain, 0, MAX_BRAND);
    }
  }
}
