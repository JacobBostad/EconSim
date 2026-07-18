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
import { APARTMENT_SATISFACTION_BONUS } from '../data/constants';
import { tierNeedGrowthMult } from './TierSystem';

/** Needs never accumulate beyond this urgency. */
const URGENCY_CAP = 3;

/** Going hungry hurts much more than missing a new tool or outfit; a missed
 * luxury barely registers. Shared with trip planning: citizens prioritize
 * shopping by FELT urgency (urgency × this weight), so a scarce new craving
 * can never hijack the daily trip away from staples. */
export function needWeight(productId: string): number {
  const p = getProduct(productId);
  if (p.satisfactionWeight !== undefined) return p.satisfactionWeight;
  const t = p.needType;
  if (t === 'food') return 1.4;
  if (t === 'luxury') return 0.2;
  return 0.55;
}

/** Rate a lapsed luxury craving fades for citizens below the ladder. */
const LUXURY_DECAY_PER_DAY = 0.1;

/** Whether any staffed store in town currently sells the product. */
function soldSomewhere(state: import('../core/GameState').GameState, productId: string): boolean {
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.retailProductIds.includes(productId) && f.status !== 'closed' && f.employees.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Pressure a single need exerts on its owner's equilibrium, from its CURRENT
 * urgency (pure — no growth step). Shared with the satisfaction-anatomy
 * selector so the UI decomposition always matches the engine math.
 */
export function pressureOf(
  state: import('../core/GameState').GameState,
  config: import('../core/SimulationConfig').SimulationConfig,
  need: { productId: string; urgency: number },
): number {
  if (need.urgency <= config.needUrgentThreshold) return 0;
  const anySeller = soldSomewhere(state, need.productId);
  return (
    (need.urgency - config.needUrgentThreshold) *
    needWeight(need.productId) *
    (anySeller ? 1 : 0.5)
  );
}

export function runSatisfactionSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, config } = ctx;

  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    let unmetPressure = 0;
    for (const need of cit.needs) {
      // Tiered demand: the prosperity ladder scales each tier's appetite.
      // Luxury multipliers hit 0 for workers — the ladder replaced the old
      // satisfaction+cash aspiration gate, so new money must climb (with
      // hysteresis) before it turns into new tastes.
      const mult = tierNeedGrowthMult(cit.tier, need.productId);
      if (mult <= 0 && getProduct(need.productId).needType === 'luxury') {
        need.urgency = Math.max(0, need.urgency - LUXURY_DECAY_PER_DAY);
      } else {
        need.urgency = Math.min(URGENCY_CAP, need.urgency + need.urgencyGrowthPerDay * mult);
      }
      unmetPressure += pressureOf(state, config, need);
    }

    // Satisfaction drifts toward an equilibrium set by circumstances instead
    // of saturating at 0/100: employed & fully provided ≈ 85, unemployed but
    // provided ≈ 60 (subsistence keeps life okay), chronic shortages pull far
    // lower. Purchases/stockouts still nudge it intraday (RetailDemandSystem).
    let target = 50;
    target += cit.employmentStatus === 'employed' ? 20 : -5;
    // Premium housing: apartment residents live a little better.
    if (state.facilities[cit.homeFacilityId]?.defId === 'apartment') {
      target += APARTMENT_SATISFACTION_BONUS;
    }
    // Smooth provisioning curve: fully provided = +15, and small chronic
    // cravings (a coffee craze with no café in town) erode it gradually
    // instead of a cliff from +15 to negative the moment any need is unmet.
    target += clamp(15 - unmetPressure * 12, -30, 15);
    cit.satisfaction = clamp(
      cit.satisfaction + (clamp(target, 0, 100) - cit.satisfaction) * 0.12,
      0,
      100,
    );
  }
}
