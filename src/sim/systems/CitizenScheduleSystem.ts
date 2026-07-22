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
import { townOf } from '../core/Town';
import { chooseBestStore } from './RetailDemandSystem';

export function isWorkTime(ctx: SimContext): boolean {
  const h = ctx.time.hour;
  return h >= ctx.config.workStartHour && h < ctx.config.workEndHour;
}

export function isShopTime(ctx: SimContext): boolean {
  const h = ctx.time.hour;
  return h >= ctx.config.shopStartHour && h < ctx.config.shopEndHour;
}

/**
 * Needs above the shopping threshold, most urgent first. The schedule tries
 * them in order and takes the first one an open store actually sells — an
 * unservable craving (nobody in town sells clothes) must never block a
 * citizen from buying bread.
 */
function shoppableNeeds(ctx: SimContext, cit: Citizen): Citizen['needs'] {
  // Raw urgency, deliberately NOT weighted by satisfaction impact: buying a
  // need drops its urgency below the others, which is what rotates trips
  // across products. (A weighted sort was tried and measured: staples then
  // outrank everything permanently and tools/clothes trips never recur.)
  return cit.needs
    .filter((n) => n.urgency >= ctx.config.needUrgencyThreshold)
    .sort((a, b) => b.urgency - a.urgency);
}

export function runCitizenScheduleSystem(ctx: SimContext): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  for (const id in town.citizens) {
    const cit = town.citizens[id]!;
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

    // 2) Shopping: in the window, or whenever a need is urgent (and not at
    // work). Urgency never overrides store hours: a 3am trip just bounces off
    // a closed door — measured as ~25 phantom "lost sales"/day per store and a
    // nightly satisfaction drain, all retry inflation. The need keeps its
    // urgency and the citizen shops at opening time instead.
    const storesOpenNow =
      ctx.time.hour >= ctx.config.storeOpenHour &&
      ctx.time.hour < ctx.config.storeCloseHour;
    const offCooldown =
      state.tick - cit.lastShopTick >= ctx.config.shoppingCooldownTicks;
    if (offCooldown && storesOpenNow && !(employed && isWorkTime(ctx))) {
      let commuting = false;
      for (const need of shoppableNeeds(ctx, cit)) {
        if (!isShopTime(ctx) && need.urgency < ctx.config.needUrgentThreshold) continue;
        const store = chooseBestStore(ctx, cit, need.productId);
        if (store) {
          cit.lastShopTick = state.tick;
          startCommute(cit, store.id, store.location, 'commuting-to-shop');
          commuting = true;
          break;
        }
      }
      if (commuting) continue;
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
