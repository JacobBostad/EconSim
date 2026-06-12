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
import { clamp } from '../../utils/clamp';

/** Needs never accumulate beyond this urgency. */
const URGENCY_CAP = 3;

export function runSatisfactionSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state, config } = ctx;

  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    let unmetPressure = 0;
    for (const need of cit.needs) {
      need.urgency = Math.min(URGENCY_CAP, need.urgency + need.urgencyGrowthPerDay);
      if (need.urgency > config.needUrgentThreshold) {
        unmetPressure += need.urgency - config.needUrgentThreshold;
      }
    }

    let delta = 0;
    delta += cit.employmentStatus === 'employed' ? 1 : -1.5;
    delta -= unmetPressure * 2;
    if (unmetPressure === 0) delta += 1;

    cit.satisfaction = clamp(cit.satisfaction + delta, 0, 100);
  }
}
