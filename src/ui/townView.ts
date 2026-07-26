/**
 * townView.ts — pure, React-free helpers behind the town switcher (region.md
 * step 5, first slice: the player can LOOK at Port Rosa).
 *
 * Everything the switcher UI needs to DECIDE (is there a partner to look at? is
 * the current view the home town, i.e. may the player operate?) and to SHOW (the
 * partner's read-only book — its crowd size, its prices, its export cover) lives
 * here as plain functions over `GameState` + a `selectedTownId`, so the store,
 * the map guard, and the panel all read ONE source of truth and it is unit
 * testable without a DOM.
 *
 * The slice is deliberately VIEW-ONLY: `isHomeView` is the single gate the map
 * uses to keep every mutating interaction (build mode, entity-select commands)
 * home-scoped. The design (region.md §3b) keeps player-command handlers on the
 * home default until the multi-town-player UI — so the guard here is the UI
 * promise that matches it: you may look at the partner, you may not act there.
 */

import type { GameState } from '../sim/core/GameState';
import type { TownId } from '../sim/core/Town';
import { HOME_TOWN_ID, sortedTownIds } from '../sim/core/Town';
import { getTradeCity } from '../sim/data/tradeCities';
import { getProduct } from '../sim/data/products';
import { partnerCoverDays } from '../sim/core/PartnerMarket';

/** How a town names/badges itself in the switcher. */
export interface TownLabel {
  id: TownId;
  name: string;
  emoji: string;
}

/**
 * The partner towns the player can LOOK at — every town in the region that is
 * not home, in the canonical sorted order. Empty in a one-town region (every
 * flag-off game), which is what makes the switcher vanish with the flag off.
 */
export function partnerTownIds(state: GameState): TownId[] {
  return sortedTownIds(state).filter((id) => id !== HOME_TOWN_ID);
}

/**
 * Whether the town switcher should render at all: the region flag is on AND a
 * partner town actually exists to switch to. Flag off ⇒ false ⇒ no switcher
 * chrome renders, so the flag-off UI is byte-identical (no new chrome).
 */
export function showSwitcher(state: GameState): boolean {
  return state.config.regionEnabled && partnerTownIds(state).length > 0;
}

/** Whether the current view is the home town — the ONLY view the player may
 * operate in this slice. The map's build/select guards read exactly this. */
export function isHomeView(selectedTownId: TownId): boolean {
  return selectedTownId === HOME_TOWN_ID;
}

/**
 * The switcher's label for a town id. Home carries a fixed house badge; a
 * partner reuses its trade-city name/emoji (Port Rosa 🚢) so the switcher and
 * the Gazette trade desk speak the same names.
 */
export function townLabel(id: TownId): TownLabel {
  if (id === HOME_TOWN_ID) return { id, name: 'Home', emoji: '🏠' };
  const city = getTradeCity(id);
  return { id, name: city.name, emoji: city.emoji };
}

/** All town labels in switcher order: home first, then partners sorted. */
export function townLabels(state: GameState): TownLabel[] {
  return [townLabel(HOME_TOWN_ID), ...partnerTownIds(state).map(townLabel)];
}

/** One product's line in the partner's read-only book. */
export interface PartnerBookRow {
  productId: string;
  name: string;
  /** Latest sales-weighted price (cents; 0 until the book has a sale). */
  price: number;
  /** Days of export cover the partner's larder represents; undefined = it does
   * not stock the product (bare walk, no chip). */
  coverDays: number | undefined;
}

/** The partner's read-only book: its crowd size and its per-product prices/cover. */
export interface PartnerBook {
  townId: TownId;
  label: TownLabel;
  /** Total cohort population — the port's crowd size (it is a cast-less town). */
  crowd: number;
  rows: PartnerBookRow[];
}

/**
 * Read a partner town's book for the info panel. Pure read over
 * `state.towns[townId]` — no mutation, no rng, no money. Rows are the products
 * the town's market tracks, in sorted product-id order (deterministic); price is
 * the latest finalized day's average (or today's running average before the
 * first close), cover comes from the same `partnerCoverDays` the freight quote
 * uses. Returns undefined when the town does not exist (defensive; a caller only
 * asks for a partner it just listed).
 */
export function partnerBook(state: GameState, townId: TownId): PartnerBook | undefined {
  const town = state.towns[townId];
  if (!town) return undefined;
  let crowd = 0;
  for (const cid of Object.keys(town.cohorts).sort()) {
    crowd += town.cohorts[cid]!.population;
  }
  const rows: PartnerBookRow[] = [];
  for (const pid of Object.keys(town.marketStats).sort()) {
    const st = town.marketStats[pid]!;
    const last = st.history.length > 0 ? st.history[st.history.length - 1]! : undefined;
    const price = last && last.averagePrice > 0 ? last.averagePrice : st.averagePrice;
    const cover = partnerCoverDays(state, townId, pid);
    rows.push({
      productId: pid,
      name: getProduct(pid).name,
      price,
      coverDays: Number.isFinite(cover) ? cover : undefined,
    });
  }
  return { townId, label: townLabel(townId), crowd, rows };
}
