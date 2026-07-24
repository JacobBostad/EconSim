/**
 * PartnerMarket.ts — the LIVE partner's export quote from its REAL book (Arc E
 * step 4, slice 5: "retire the pool table, the gradient's end").
 *
 * Through slice 4 a graduated partner (`port_rosa`) still quoted through the
 * stub `TradeCityPool` — a separate `population` + `inventory` dict on the trade
 * book, updated by `updatePools`. Slice 5 RETIRES that interface for the live
 * partner: its export cover now reads the partner town's REAL economy —
 *
 *   - STOCK  = the partner's real retail-shelf units of the product (the larder
 *              the crowd shops and exports land in), summed across its stores;
 *   - DEMAND = the partner cohorts' ACTUAL recent daily consumption of it, read
 *              off the partner's own `marketStats` sales history (so it is
 *              tier-correct for free — a worker-tier crowd that never buys a
 *              luxury reports zero demand for it, and that product simply quotes
 *              the bare walk, no hand-authored table);
 *   - COVER  = STOCK / DEMAND, mapped through the SAME clamped cover curve the
 *              stub pool used (`coverMult`, `tradePool.ts`), targeting the same
 *              `TRADE_POOL_TARGET_COVER_DAYS` buffer.
 *
 * The partner's shelves are kept near that buffer by `PartnerMarketSystem`
 * (the town's own supply side — production + a gap-import tender, on the real
 * shelf, cash-free and rng-free, the `updatePools` logic moved onto real stock),
 * so in steady state the quote sits on the walk and a SHOCK (drain the shelf)
 * moves it exactly as a real inventory overhang/shortage would.
 *
 * This is a PRICE READ over the partner's real records — it holds no money and
 * draws no rng. The stub pool path is UNCHANGED for `ironvale`, every stub city,
 * and every flag-off game (where `port_rosa` is a stub too — the pool row STAYS):
 * `isLivePartnerCity` is the single gate, and it is false in all of those.
 */

import type { GameState } from './GameState';
import type { ProductId } from './Id';
import type { Facility } from '../entities/Facility';
import { HOME_TOWN_ID } from './Town';
import { getProduct } from '../data/products';
import { getQuantity, addStock, removeStock } from '../entities/Inventory';
import { coverMult } from '../data/tradePool';
import { TRADE_POOL_TARGET_COVER_DAYS } from '../data/constants';

/**
 * How many days of the partner's own sales history the demand read averages. A
 * SHORT window so the export quote tracks a partner-side shock quickly (a
 * drained larder is felt within days, not smoothed away) and the shelf restock
 * activates early in the seed ramp — while still averaging out single-day sales
 * jitter. Deterministic (a mean over stored snapshots, no rng).
 */
export const PARTNER_DEMAND_WINDOW_DAYS = 3;

/**
 * Whether `cityId` is a LIVE partner town — the region flag is on AND the trade
 * city has graduated to a real simulated town in `state.towns`. Exactly the
 * `isFreightDest` gate (they must agree: a city on the freight edge is one whose
 * quote comes from its real book). A stub trade city (`ironvale`, absent from
 * `state.towns`), the home town, and every flag-off game are all false, so they
 * keep the stub pool path byte-for-byte.
 */
export function isLivePartnerCity(state: GameState, cityId: string): boolean {
  return (
    state.config.regionEnabled && cityId !== HOME_TOWN_ID && state.towns[cityId] !== undefined
  );
}

/**
 * The partner cohorts' ACTUAL recent daily consumption of a product (units/day),
 * averaged over the last `PARTNER_DEMAND_WINDOW_DAYS` finalized days of the
 * partner's own market book. Zero until the book has history (the seed ramp) and
 * zero for a product this tier of crowd never buys — both correctly yielding a
 * bare-walk quote (no cover effect). This is the mapping region.md §4 named:
 * `poolConsumptionPerDay` (def population × spec) → the partner cohorts' REAL
 * demand (measured sales), tier-correct with no second table.
 */
export function partnerDailyDemand(state: GameState, cityId: string, pid: ProductId): number {
  const town = state.towns[cityId];
  const st = town?.marketStats[pid];
  if (!st || st.history.length === 0) return 0;
  const n = Math.min(PARTNER_DEMAND_WINDOW_DAYS, st.history.length);
  let sum = 0;
  for (let i = st.history.length - n; i < st.history.length; i++) {
    sum += st.history[i]!.unitsSold;
  }
  return sum / n;
}

/**
 * The partner's retail store that carries a product (its larder for it): the
 * first by sorted facility id, deterministic. Undefined when the port stocks no
 * store for the product (then it has no larder to quote/feed — bare walk).
 */
export function partnerLarderStore(
  state: GameState,
  cityId: string,
  pid: ProductId,
): Facility | undefined {
  const town = state.towns[cityId];
  if (!town) return undefined;
  for (const fid of Object.keys(town.facilities).sort()) {
    const f = town.facilities[fid]!;
    if (f.type === 'retail' && f.retailProductIds.includes(pid)) return f;
  }
  return undefined;
}

/**
 * The partner's real shelf stock of a product — its export larder — summed over
 * every retail store carrying it. `undefined` (not 0) when the port has no store
 * for the product, so the caller quotes the bare walk (a product the port
 * doesn't trade) rather than a zero-stock max premium.
 */
export function partnerLarderStock(
  state: GameState,
  cityId: string,
  pid: ProductId,
): number | undefined {
  const town = state.towns[cityId];
  if (!town) return undefined;
  let has = false;
  let sum = 0;
  for (const fid in town.facilities) {
    const f = town.facilities[fid]!;
    if (f.type === 'retail' && f.retailProductIds.includes(pid)) {
      has = true;
      sum += getQuantity(f.inputInventory, pid);
    }
  }
  return has ? sum : undefined;
}

/** Days of cover the partner's real larder represents (stock ÷ real demand).
 * Infinity when the port doesn't stock it or the crowd doesn't buy it. */
export function partnerCoverDays(state: GameState, cityId: string, pid: ProductId): number {
  const stock = partnerLarderStock(state, cityId, pid);
  if (stock === undefined) return Infinity;
  const d = partnerDailyDemand(state, cityId, pid);
  return d > 0 ? stock / d : Infinity;
}

/**
 * The cover multiplier the LIVE partner applies to a product's walked quote,
 * from its REAL shelf stock and REAL recent demand, via the shared clamped cover
 * curve. 1 (bare walk) when the port doesn't stock the product or the crowd
 * doesn't buy it (demand 0 ⇒ no cover signal).
 */
export function partnerCoverMult(state: GameState, cityId: string, pid: ProductId): number {
  const stock = partnerLarderStock(state, cityId, pid);
  if (stock === undefined) return 1;
  const d = partnerDailyDemand(state, cityId, pid);
  if (d <= 0) return 1;
  return coverMult(TRADE_POOL_TARGET_COVER_DAYS * d, stock);
}

/**
 * Move the partner's real larder by `delta` units (the live-partner analogue of
 * `feedPool`): an export/freight arrival ships goods IN (+), a city-purchase
 * draws them OUT (−). Lands on the store that carries the product; a no-op if the
 * port stocks none. Pure stock bookkeeping — no money moves here (the trade's
 * cash settled through recordTransaction). The changed cover shows in the next
 * `cityPrice` read, exactly as the pool's `feedPool` did.
 */
export function feedPartnerLarder(
  state: GameState,
  cityId: string,
  pid: ProductId,
  delta: number,
): void {
  const store = partnerLarderStore(state, cityId, pid);
  if (!store) return;
  if (delta >= 0) {
    addStock(store.inputInventory, pid, delta, getProduct(pid).defaultQuality);
  } else {
    removeStock(store.inputInventory, pid, Math.min(-delta, getQuantity(store.inputInventory, pid)));
  }
}

/**
 * Cover in DAYS for the desk/advisor chips, routing the live partner to its real
 * book. `undefined` = no chip (bare walk, or infinite cover with no demand). The
 * stub-pool branch stays in the selector (it owns the pool import); this covers
 * only the live-partner variant so the selectors have one call to make.
 */
export function partnerCoverDaysOrUndefined(
  state: GameState,
  cityId: string,
  pid: ProductId,
): number | undefined {
  if (!isLivePartnerCity(state, cityId)) return undefined;
  if (partnerLarderStock(state, cityId, pid) === undefined) return undefined;
  const cd = partnerCoverDays(state, cityId, pid);
  return Number.isFinite(cd) ? cd : undefined;
}
