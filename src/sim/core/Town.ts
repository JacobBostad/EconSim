/**
 * Town.ts — the region's town seam (Arc E, region.md step 3).
 *
 * The simulation's six town-scoped record families — districts, cohorts,
 * citizens, marketStats, firms, facilities — now LIVE at `state.towns[townId]`
 * (the endgame shape, option (c) in region.md). `townOf(state, townId)` returns
 * a lightweight view whose getters read `state.towns[townId]`; in the one-town
 * region every id resolves to the home town, so `townOf(state,'home').firms IS
 * state.towns.home.firms`, the same reference every converted call site already
 * routes through — no call site changed on the endgame move.
 *
 * The old flat paths (`state.firms`, `state.districts`, ...) survive as
 * **non-enumerable accessor aliases** onto `towns[HOME_TOWN_ID]` (installed by
 * `installTownAliases`, called from every state-construction path: fresh game,
 * deserialize, migration). A writer that still does `state.firms[id] = ...` or
 * `delete state.facilities[x]` mutates the live home-town record through the
 * alias; a wholesale `state.districts = {...}` replaces the record inside
 * `towns.home`. Because the aliases are non-enumerable, `JSON.stringify` skips
 * them — a save serializes ONLY the `towns` key, never the six flat keys, so
 * there is no doubling (this is what makes option (c) sound where the naive
 * aliasing option (a) was rejected). See docs/design/region.md § "Step 3
 * as-built" → "endgame, as landed".
 */

import type { GameState } from './GameState';
import type { District } from '../entities/District';
import type { Cohort } from '../entities/Cohort';
import type { Citizen } from '../entities/Citizen';
import type { MarketStat } from '../entities/Market';
import type { Firm } from '../entities/Firm';
import type { Facility } from '../entities/Facility';

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
 * The six town-scoped record families, stored together as `state.towns[townId]`.
 * This is the home of the records at the endgame move (region.md step 3 option
 * (c)); the flat `state.firms`/`state.districts`/... paths are non-enumerable
 * accessor aliases onto `towns[HOME_TOWN_ID]` (see `installTownAliases`).
 */
export interface TownRecords {
  districts: Record<string, District>;
  cohorts: Record<string, Cohort>;
  citizens: Record<string, Citizen>;
  marketStats: Record<string, MarketStat>;
  firms: Record<string, Firm>;
  facilities: Record<string, Facility>;
  /**
   * The town's own map dimensions (region.md step 4, slice 1). A town OWNS its
   * map now — two towns need two maps — so map size is a per-town record field,
   * NOT a `state.config` delegate. Home's are set = `config.mapWidth`/`.mapHeight`
   * at construction (after the size-preset block finalizes them) and defaulted
   * from config on load/migration, so the getter swap is provably identity for
   * home (every existing game reads exactly `config.mapWidth`). A partner town
   * (`seedTown`) carries its own preset-derived dims. See `townOf` below.
   */
  mapWidth: number;
  mapHeight: number;
}

/** The record-family keys, in a fixed order — the alias set installers loop. */
export const TOWN_RECORD_KEYS = [
  'districts',
  'cohorts',
  'citizens',
  'marketStats',
  'firms',
  'facilities',
] as const;

/**
 * A town's town-scoped records, as a VIEW over `state.towns[townId]`. Getters,
 * not fields: reading `.districts` returns the live `towns[townId].districts`
 * object, so a converted call site is provably identical to the flat access it
 * replaced (in the one-town region the home town's records ARE the flat aliases).
 *
 * All six record families are exposed (districts, cohorts, citizens,
 * marketStats, firms, facilities), plus the town's map dimensions (mapWidth,
 * mapHeight). Map dims now read the town's OWN record fields (region.md step 4,
 * slice 1) — a town owns its map, so two towns carry two maps. For home the
 * field is set = `config.mapWidth`/`.mapHeight`, so the getter is a provable
 * identity with the pre-slice `config` delegate. The recipe is in region.md.
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
  /** Firms headquartered in the town, by id (town-scoped). */
  readonly firms: Record<string, Firm>;
  /** The town's buildings — production, retail, homes — by id (town-scoped). */
  readonly facilities: Record<string, Facility>;
  /**
   * The town's map width — the world-space extent that placement, movement
   * bounds, slot enumeration, and the renderer all key off (town-scoped). Reads
   * the town's OWN `mapWidth` record field now (region.md step 4, slice 1): a
   * town owns its map, so two towns can carry two different maps. For home the
   * field is set = `config.mapWidth` at construction and on load, so this is a
   * provable identity with the pre-slice `config.mapWidth` delegate. Config-
   * construction/serialization/migration/NewGame-setup readers stay on `config`.
   */
  readonly mapWidth: number;
  /**
   * The town's map height — the world-space extent that placement, movement
   * bounds, slot enumeration, and the renderer all key off (town-scoped). Reads
   * the town's OWN `mapHeight` record field now, alongside `mapWidth`; for home
   * it is set = `config.mapHeight`, an identity with the old delegate.
   */
  readonly mapHeight: number;
}

/**
 * The town a system is operating on, as a view over the flat records. In the
 * one-town region every `townId` resolves to the home town's flat records; the
 * argument exists so call sites already carry the town context the endgame
 * needs. Cheap to call (one small object with two getters) but hoist it to a
 * local at the top of a hot loop rather than calling per-iteration.
 */
export function townOf(state: GameState, _townId: TownId = HOME_TOWN_ID): Town {
  // The records genuinely live here now. One-town region: every id resolves to
  // the home town, so an unknown id (a bare-`state` helper's default, a partner
  // id that does not exist yet) falls back to home — identity is preserved.
  const records = state.towns[_townId] ?? state.towns[HOME_TOWN_ID]!;
  return {
    id: _townId,
    get districts(): Record<string, District> {
      return records.districts;
    },
    get cohorts(): Record<string, Cohort> {
      return records.cohorts;
    },
    get citizens(): Record<string, Citizen> {
      return records.citizens;
    },
    get marketStats(): Record<string, MarketStat> {
      return records.marketStats;
    },
    get firms(): Record<string, Firm> {
      return records.firms;
    },
    get facilities(): Record<string, Facility> {
      return records.facilities;
    },
    get mapWidth(): number {
      return records.mapWidth;
    },
    get mapHeight(): number {
      return records.mapHeight;
    },
  };
}

/**
 * Install the flat back-compat aliases (`state.firms`, `state.districts`, ...)
 * as NON-ENUMERABLE accessor properties onto `state`, each aliasing the matching
 * field of `state.towns[HOME_TOWN_ID]`. Every state-construction path calls this
 * (fresh game, deserialize, migration) so that:
 *
 *  - existing writers keep working — `state.firms[id] = x` and
 *    `delete state.facilities[x]` mutate the live home-town record through the
 *    getter; a wholesale `state.districts = {...}` replaces the record inside
 *    `towns.home` through the setter (so any wholesale-replacement writer, e.g.
 *    the migration defaulter, still lands in the right place);
 *  - JSON serialization sees ONLY the `towns` key — the aliases are
 *    non-enumerable, so `JSON.stringify` skips them and no record doubles.
 *
 * Idempotent and defensive: it creates `towns`/`towns.home` if a raw load is
 * missing them, and redefines the six keys (configurable) if they already exist
 * as own properties (e.g. the fresh-game literal builds them enumerable, then
 * this call demotes them to the non-enumerable aliases).
 */
export function installTownAliases(state: GameState): void {
  const s = state as unknown as {
    towns?: Record<TownId, TownRecords>;
  } & Record<string, unknown>;
  if (!s.towns) s.towns = {};
  if (!s.towns[HOME_TOWN_ID]) s.towns[HOME_TOWN_ID] = {} as TownRecords;
  for (const key of TOWN_RECORD_KEYS) {
    Object.defineProperty(state, key, {
      get(): unknown {
        return (state.towns[HOME_TOWN_ID] as unknown as Record<string, unknown>)[key];
      },
      set(v: unknown): void {
        (state.towns[HOME_TOWN_ID] as unknown as Record<string, unknown>)[key] = v;
      },
      enumerable: false,
      configurable: true,
    });
  }
}
