/**
 * Town.ts — the region's town seam (Arc E, region.md step 3).
 *
 * Today the simulation is a single flat town: the entity records live at the
 * top of GameState (`state.districts`, `state.cohorts`, and eventually
 * `state.firms/.facilities/.citizens/.marketStats`). The region arc moves those
 * records down one level, to `state.towns[townId]`, and teaches every system
 * which town it operates on. That is a ~1,300-site move under an absolute
 * bit-identity contract, so it cannot land in one patch.
 *
 * This file lands the SAFEST first step of that gradient: the Town as a **view**,
 * not stored state. `townOf(state, townId)` returns a lightweight object whose
 * accessors delegate straight back to the flat records — `townOf(state,'home')
 * .districts` IS `state.districts`, the same reference. Because the view is
 * computed, not serialized, NO `towns` key ever enters a save: the serialized
 * bytes are unchanged and there is zero migration. Systems adopt the accessor
 * one call site at a time, and the bit-identity harness proves each conversion
 * behaviour-identical (the accessor returns the same objects the flat path did).
 *
 * The endgame (region.md step 3's "records genuinely MOVE") swaps only the two
 * getters in `townOf` to read `state.towns[townId]` and leaves flat back-compat
 * getters at the old paths. Every call site already routed through `townOf` is
 * correct on that day without a further edit — which is the whole point of
 * landing the accessor first. See docs/design/region.md § "Step 3 as-built".
 */

import type { GameState } from './GameState';
import type { District } from '../entities/District';
import type { Cohort } from '../entities/Cohort';
import type { Citizen } from '../entities/Citizen';
import type { MarketStat } from '../entities/Market';

/** A town's identity within the region. One-town region: only `home` exists. */
export type TownId = string;

/**
 * The home town — the single town every pre-region game is. In a one-town
 * region every `townId` resolves here, so a system that has no town context yet
 * (a bare-`state` helper mid-gradient) reads the home town by default and stays
 * byte-identical. The endgame gives partner towns their own ids.
 */
export const HOME_TOWN_ID: TownId = 'home';

/**
 * A town's town-scoped records, as a VIEW over the flat GameState. Getters, not
 * fields: reading `.districts` returns the live `state.districts` object, so a
 * converted call site is provably identical to the flat access it replaced.
 *
 * The district, cohort, citizen, and marketStats families are exposed today
 * (region.md step 3's first three slices). The remaining families (firms,
 * facilities, map dims) join this view batch by batch as their readers convert;
 * the recipe is in region.md.
 */
export interface Town {
  readonly id: TownId;
  /** City districts — the map's metadata partition (town-scoped). */
  readonly districts: Record<string, District>;
  /** The crowd's cohorts, keyed `districtId:tier` (town-scoped). */
  readonly cohorts: Record<string, Cohort>;
  /** The simulated cast — individual citizens by id (town-scoped). */
  readonly citizens: Record<string, Citizen>;
  /** Per-product market book — prices, shares, daily history (town-scoped). */
  readonly marketStats: Record<string, MarketStat>;
}

/**
 * The town a system is operating on, as a view over the flat records. In the
 * one-town region every `townId` resolves to the home town's flat records; the
 * argument exists so call sites already carry the town context the endgame
 * needs. Cheap to call (one small object with two getters) but hoist it to a
 * local at the top of a hot loop rather than calling per-iteration.
 */
export function townOf(state: GameState, _townId: TownId = HOME_TOWN_ID): Town {
  return {
    id: _townId,
    get districts(): Record<string, District> {
      return state.districts;
    },
    get cohorts(): Record<string, Cohort> {
      return state.cohorts;
    },
    get citizens(): Record<string, Citizen> {
      return state.citizens;
    },
    get marketStats(): Record<string, MarketStat> {
      return state.marketStats;
    },
  };
}
