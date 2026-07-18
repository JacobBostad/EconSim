/**
 * LandValue.ts — location economics.
 *
 * Land value at a point is driven by foot traffic: proximity to homes (each
 * resident makes nearby ground more valuable). It is computed on demand, never
 * stored, so it stays consistent as the town grows.
 *
 * Effects (applied where facilities are built):
 *   buildCost            × landCostMultiplier   (0.8× remote … 1.6× downtown)
 *   operatingCostPerDay  × landCostMultiplier   ("rent", locked in at build)
 *
 * The upside of expensive ground is built into demand already: citizens favor
 * nearby stores (distance term in the store score), so paying downtown rent
 * buys real customers. Cheap remote land = fewer walk-ins but lower overhead.
 */

import type { GameState } from './GameState';
import type { Vec2 } from '../entities/Location';

/** Distance beyond which a home contributes nothing. */
const HOME_REACH = 45;
/** Residents-worth of proximity that saturates land value at 1. */
const SATURATION = 26;

/** Land value in [0, 1] at a map location. */
export function landValueAt(state: GameState, loc: Vec2): number {
  let pull = 0;
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.type !== 'home') continue;
    const dx = fac.location.x - loc.x;
    const dy = fac.location.y - loc.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= HOME_REACH) continue;
    const residents = Math.max(1, fac.residentIds.length);
    pull += residents * (1 - dist / HOME_REACH);
  }
  return Math.min(1, pull / SATURATION);
}

/** Cost multiplier applied to build cost and daily maintenance. */
export function landCostMultiplier(landValue: number): number {
  return 0.8 + 0.8 * landValue;
}
