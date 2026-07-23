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
 *
 * A4 land-value cache: the money path still resolves a point value live (see the
 * timing contract on landValueAt), but the two O(homes) *sweeps* — the renderer's
 * cols×rows overlay grid and DistrictSystem's per-district aggregate — reuse one
 * `HomeIndex` snapshot instead of re-walking `state.facilities` per query. The
 * index yields byte-identical values (districtLandValue.test.ts pins this on a live
 * city), so it is a pure caching layer, not a rebalance.
 */

import type { GameState } from './GameState';
import type { Vec2 } from '../entities/Location';
import { townOf } from './Town';

/** Distance beyond which a home contributes nothing. */
const HOME_REACH = 45;
/** Residents-worth of proximity that saturates land value at 1. */
const SATURATION = 26;

/**
 * A snapshot of the town's homes flattened for repeated land-value queries:
 * parallel position + resident-count arrays, collected in the SAME order the
 * `for fid in state.facilities` scan visits them so summation order — and thus
 * the floating-point result — is preserved bit-for-bit. Build it once and query
 * it many times: the renderer samples a cols×rows grid over one unchanged home
 * set (thousands of queries), and DistrictSystem samples one point per district;
 * both used to re-walk every facility per query.
 */
export interface HomeIndex {
  xs: Float64Array;
  ys: Float64Array;
  residents: Float64Array;
  count: number;
}

/** Snapshot the current homes for repeated {@link landValueFromIndex} queries. */
export function buildHomeIndex(state: GameState): HomeIndex {
  // Two passes so the typed arrays are exact-sized. Both iterate facilities in
  // insertion order, so the index visits homes in the identical order the direct
  // scan did — the invariant the byte-identity of every query rests on.
  let count = 0;
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const facilities = townOf(state).facilities;
  for (const fid in facilities) {
    if (facilities[fid]!.type === 'home') count += 1;
  }
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const residents = new Float64Array(count);
  let i = 0;
  for (const fid in facilities) {
    const fac = facilities[fid]!;
    if (fac.type !== 'home') continue;
    xs[i] = fac.location.x;
    ys[i] = fac.location.y;
    residents[i] = Math.max(1, fac.residentIds.length);
    i += 1;
  }
  return { xs, ys, residents, count };
}

/**
 * Land value in [0, 1] at `loc`, summed over a prebuilt home index. Byte-identical
 * to the direct facility scan: the same homes are summed in the same order with
 * the same terms. The `|dx| >= REACH || |dy| >= REACH` reject only short-circuits
 * homes whose Euclidean distance is therefore also >= REACH — the direct scan
 * reaches the same `continue` via its own distance check, so no summed term moves.
 */
export function landValueFromIndex(index: HomeIndex, loc: Vec2): number {
  let pull = 0;
  const { xs, ys, residents, count } = index;
  for (let i = 0; i < count; i += 1) {
    const dx = xs[i]! - loc.x;
    const dy = ys[i]! - loc.y;
    if (dx >= HOME_REACH || dx <= -HOME_REACH || dy >= HOME_REACH || dy <= -HOME_REACH) continue;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= HOME_REACH) continue;
    pull += residents[i]! * (1 - dist / HOME_REACH);
  }
  return Math.min(1, pull / SATURATION);
}

/**
 * Land value in [0, 1] at a map location.
 *
 * TIMING CONTRACT: this resolves LIVE — it snapshots the homes present at call
 * time. The money path (build cost / locked-in rent) reads it at the exact tick a
 * facility is placed, so a home raised earlier the same tick is already priced
 * in. A per-district DAILY cache cannot honor that (a mid-day build would shift
 * the direct value the moment it lands), so the A4 cache deliberately does NOT
 * back this selector — it backs the two whole-town SWEEPS, which tolerate a
 * snapshot because they redraw/recompute on the day boundary anyway. Keeping the
 * money path live is what preserves Village bit-identity and the City land-cost
 * calibration. The index round-trip is byte-identical, so routing through it
 * changes nothing but the constant factor (skips non-home facilities).
 */
export function landValueAt(state: GameState, loc: Vec2): number {
  return landValueFromIndex(buildHomeIndex(state), loc);
}

/** Cost multiplier applied to build cost and daily maintenance. */
export function landCostMultiplier(landValue: number): number {
  return 0.8 + 0.8 * landValue;
}
