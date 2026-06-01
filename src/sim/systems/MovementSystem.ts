/**
 * MovementSystem — advances citizens and vehicles toward their targets.
 *
 * On arrival, a citizen's commuting-* activity is resolved into the
 * corresponding settled/active state (working / shopping / home). Vehicles that
 * arrive are flagged 'delivered'; the LogisticsSystem performs the actual cargo
 * transfer and removes them.
 */

import type { SimContext } from '../core/GameState';
import { moveToward } from '../entities/Location';

export function runMovementSystem(ctx: SimContext): void {
  const { state, config } = ctx;

  for (const id in state.citizens) {
    const cit = state.citizens[id]!;
    if (cit.movementState !== 'moving') continue;
    const { pos, arrived } = moveToward(
      cit.currentLocation,
      cit.targetLocation,
      config.citizenSpeed,
    );
    cit.currentLocation = pos;
    if (arrived) {
      cit.movementState = 'idle';
      switch (cit.activity) {
        case 'commuting-to-work':
          cit.activity = 'working';
          break;
        case 'commuting-to-shop':
          cit.activity = 'shopping';
          break;
        case 'commuting-home':
          cit.activity = 'home';
          break;
        default:
          break;
      }
    }
  }

  for (const id in state.vehicles) {
    const v = state.vehicles[id]!;
    if (v.status !== 'enroute') continue;
    const { pos, arrived } = moveToward(
      v.currentLocation,
      v.targetLocation,
      config.vehicleSpeed,
    );
    v.currentLocation = pos;
    v.ticksUntilArrival = Math.max(0, v.ticksUntilArrival - 1);
    if (arrived) {
      v.status = 'delivered';
      v.ticksUntilArrival = 0;
    }
  }
}
