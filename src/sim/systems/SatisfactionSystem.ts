/**
 * SatisfactionSystem — grows citizen needs and updates satisfaction daily.
 *
 * Each day, need urgency increases by its growth rate (driving future demand).
 * Satisfaction drifts up when a citizen is employed and their needs are met, and
 * down when needs go chronically unmet. Retail purchases and missed payroll also
 * adjust satisfaction in their respective systems.
 */

import type { SimContext } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { getProduct } from '../data/products';
import { clamp } from '../../utils/clamp';

/** Needs never accumulate beyond this urgency. */
const URGENCY_CAP = 3;

/** Going hungry hurts much more than missing a new tool or outfit. */
function needWeight(productId: string): number {
  return getProduct(productId).needType === 'food' ? 1.4 : 0.55;
}

export function runSatisfactionSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, config } = ctx;

  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    let unmetPressure = 0;
    for (const need of cit.needs) {
      need.urgency = Math.min(URGENCY_CAP, need.urgency + need.urgencyGrowthPerDay);
      if (need.urgency > config.needUrgentThreshold) {
        unmetPressure +=
          (need.urgency - config.needUrgentThreshold) * needWeight(need.productId);
      }
    }

    // Satisfaction drifts toward an equilibrium set by circumstances instead
    // of saturating at 0/100: employed & fully provided ≈ 85, unemployed but
    // provided ≈ 60 (subsistence keeps life okay), chronic shortages pull far
    // lower. Purchases/stockouts still nudge it intraday (RetailDemandSystem).
    let target = 50;
    target += cit.employmentStatus === 'employed' ? 20 : -5;
    target += unmetPressure === 0 ? 15 : -unmetPressure * 10;
    cit.satisfaction = clamp(
      cit.satisfaction + (clamp(target, 0, 100) - cit.satisfaction) * 0.12,
      0,
      100,
    );
  }
}
