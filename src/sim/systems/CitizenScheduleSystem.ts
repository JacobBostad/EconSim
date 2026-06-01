/**
 * CitizenScheduleSystem — drives each citizen's daily routine.
 *
 * Runs before MovementSystem. For citizens in a "settled" state (home/sleeping/
 * working) it decides the next goal based on the hour, employment, and needs,
 * and initiates a commute if needed. MovementSystem then walks them there and
 * flips commuting-* states into the arrival state.
 *
 * Routine:
 *   - Before work hours: at home (sleeping).
 *   - Work hours + employed: at workplace (working).
 *   - After work / shop window (or urgent need): shop, then go home.
 *   - Otherwise: home.
 */

import type { SimContext } from '../core/GameState';
import type { Citizen } from '../entities/Citizen';
import { chooseBestStore } from './RetailDemandSystem';

export function isWorkTime(ctx: SimContext): boolean {
  const h = ctx.time.hour;
  return h >= ctx.config.workStartHour && h < ctx.config.workEndHour;
}

export function isShopTime(ctx: SimContext): boolean {
  const h = ctx.time.hour;
  return h >= ctx.config.shopStartHour && h < ctx.config.shopEndHour;
}

/** The citizen's most urgent need that is above the shopping threshold. */
function topUrgentNeed(ctx: SimContext, cit: Citizen): Citizen['needs'][number] | null {
  let best: Citizen['needs'][number] | null = null;
  for (const need of cit.needs) {
    if (need.urgency < ctx.config.needUrgencyThreshold) continue;
    if (!best || need.urgency > best.urgency) best = need;
  }
  return best;
}

export function runCitizenScheduleSystem(ctx: SimContext): void {
  const { state } = ctx;
  for (const id in state.citizens) {
    const cit = state.citizens[id]!;
    // Only re-plan from settled states; commuting/shopping are mid-action.
    if (
      cit.activity === 'commuting-to-work' ||
      cit.activity === 'commuting-to-shop' ||
      cit.activity === 'commuting-home' ||
      cit.activity === 'shopping'
    ) {
      continue;
    }

    const employed =
      cit.employmentStatus === 'employed' && cit.workplaceFacilityId != null;

    // 1) Work has priority during work hours.
    if (employed && isWorkTime(ctx)) {
      const wp = state.facilities[cit.workplaceFacilityId!];
      if (wp) {
        if (cit.activity !== 'working') {
          startCommute(cit, wp.id, wp.location, 'commuting-to-work');
        }
        continue;
      }
    }

    // If currently working but the shift is over, leave.
    if (cit.activity === 'working' && (!employed || !isWorkTime(ctx))) {
      // fall through to shopping/home decision below.
      cit.activity = 'home';
    }

    // 2) Shopping: in the window, or whenever a need is urgent (and not at work).
    const urgent = topUrgentNeed(ctx, cit);
    const offCooldown =
      state.tick - cit.lastShopTick >= ctx.config.shoppingCooldownTicks;
    const canShopNow =
      urgent != null &&
      offCooldown &&
      (isShopTime(ctx) || urgent.urgency >= ctx.config.needUrgentThreshold) &&
      !(employed && isWorkTime(ctx));
    if (canShopNow && urgent) {
      const store = chooseBestStore(ctx, cit, urgent.productId);
      if (store) {
        cit.lastShopTick = state.tick;
        startCommute(cit, store.id, store.location, 'commuting-to-shop');
        continue;
      }
    }

    // 3) Default: be at home (sleeping before work, home otherwise).
    const home = state.facilities[cit.homeFacilityId];
    if (home) {
      const atHome =
        cit.currentLocation.x === home.location.x &&
        cit.currentLocation.y === home.location.y;
      if (!atHome) {
        startCommute(cit, home.id, home.location, 'commuting-home');
      } else {
        cit.activity = isWorkTime(ctx) ? 'home' : 'sleeping';
        cit.movementState = 'idle';
      }
    }
  }
}

function startCommute(
  cit: Citizen,
  facilityId: string,
  location: { x: number; y: number },
  activity: Citizen['activity'],
): void {
  cit.targetFacilityId = facilityId;
  cit.targetLocation = { x: location.x, y: location.y };
  cit.activity = activity;
  cit.movementState = 'moving';
}
