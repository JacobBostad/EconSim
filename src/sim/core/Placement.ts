/**
 * Placement.ts — where a building may go.
 *
 * Manual construction rejects ground too close to an existing facility:
 * stacked buildings read as a rendering bug, and an accidental double-click
 * used to silently buy two overlapping facilities. The chain wizard keeps its
 * own, more generous clearance (it plans three buildings at once); AI firms
 * place with jittered offsets away from their own buildings and are exempt so
 * their expansion never deadlocks on a crowded block.
 */

import type { GameState } from './GameState';
import type { Vec2 } from '../entities/Location';
import type { Facility } from '../entities/Facility';
import { townOf } from './Town';

/** Minimum center-to-center distance (world units) for manual builds. The
 * biggest buildings draw ~2.6 half-widths, so 3 forbids near-total overlap
 * while still allowing a dense, city-like block. */
export const MIN_BUILD_SPACING = 3;

/** The facility standing in the way of building at `loc`, or null if clear. */
export function placementBlocker(state: GameState, loc: Vec2): Facility | null {
  const r2 = MIN_BUILD_SPACING * MIN_BUILD_SPACING;
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const facilities = townOf(state).facilities;
  for (const id in facilities) {
    const f = facilities[id]!;
    const dx = f.location.x - loc.x;
    const dy = f.location.y - loc.y;
    if (dx * dx + dy * dy < r2) return f;
  }
  return null;
}
