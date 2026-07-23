/**
 * Trade.ts — export execution to the distant trade cities, shared by the
 * EXPORT_GOODS command and standing export orders (auto-export rules on
 * warehouses). Each city quotes its own price and freight; pickBestCity is
 * the one routing rule everyone (player UI, AI, standing orders) shares.
 */

import type { GameState } from './GameState';
import { formatMoney } from '../../utils/formatMoney';
import { emitEvent, recordTransaction } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import { nextId } from './Id';
import type { FirmId, FacilityId, ProductId } from './Id';
import { getProduct } from '../data/products';
import { getQuantity, getQuality, removeStock, addStock, totalUnits } from '../entities/Inventory';
import {
  EXPORT_FREIGHT_FEE,
  FREIGHT_LEAD_DAYS,
  TRADE_PRICE_MIN_MULT,
  TRADE_PRICE_MAX_MULT,
  TRADE_POOL_TARGET_COVER_DAYS,
  TRADE_POOL_THIN_COVER_DAYS,
} from '../data/constants';
import { worldTransportMult } from '../data/worldEvents';
import { getTradeCity, TRADE_CITY_IDS, cityBias, type TradeCityId } from '../data/tradeCities';
import { poolCoverMult, poolCoverDays } from '../data/tradePool';
import { townOf, HOME_TOWN_ID } from './Town';
import { computeTime } from './Tick';
import type { FreightShipment } from '../entities/Freight';

/**
 * Price impact: trading against a city MOVES its quote — buying pushes the
 * price up, selling (or hedging demand with a forward) pushes it down, at
 * 0.15%/unit clamped to the walk's legal band. This is what makes the
 * commodity desk a market instead of a money printer: probes showed that
 * without impact, instant cross-city round trips profit every single day
 * (~$1.3k/day at 200 units) and forwards short-circuit into riskless
 * spatial arb (97% win rate). With impact, a 200-unit trade moves the
 * quote 30% against you — the first trade wins, repetition self-defeats,
 * and the daily walk's center-pull heals the market over following days.
 * Applies to every export (AI gluts soften prices too — same economics
 * for everyone).
 */
export const PRICE_IMPACT_PER_UNIT = 0.0015;

/** Average fill price for a trade of `qty` against a linear impact curve —
 * you get the first unit at the quote and the last at the fully-moved
 * price, so the fill averages the midpoint. Large orders pay their own
 * market impact instead of dumping it all on the next trader. */
export function impactedFillPrice(price: number, qty: number, direction: 1 | -1): number {
  return price * (1 + direction * (qty * PRICE_IMPACT_PER_UNIT) / 2);
}

export function applyPriceImpact(
  state: GameState,
  cityId: string,
  productId: ProductId,
  quantity: number,
  direction: 1 | -1,
): void {
  const book = state.tradeCities[cityId];
  if (!book) return;
  const center = getProduct(productId).basePrice * cityBias(cityId, productId);
  const cur = book.pricesByProduct[productId] ?? Math.round(center);
  const moved = cur * (1 + direction * quantity * PRICE_IMPACT_PER_UNIT);
  book.pricesByProduct[productId] = Math.round(
    Math.max(center * TRADE_PRICE_MIN_MULT, Math.min(center * TRADE_PRICE_MAX_MULT, moved)),
  );
}

/** Freight fee for a city, scaled by fuel conditions, capped so exports never go negative-margin by fee alone. */
export function exportFreightFee(state: GameState, cityId: string = 'port_rosa'): number {
  return Math.min(0.5, EXPORT_FREIGHT_FEE * worldTransportMult(state) * getTradeCity(cityId).freightMult);
}

/** A city's quoted price for a product (base price if unknown).
 *
 * With a demand pool live (Arc E, opt-in), the walked quote picks up the pool's
 * cover multiplier — a premium when the city's stock of this product is thin, a
 * discount when an export overhang has piled it up — clamped back into the
 * walk's own [MIN, MAX]× band so the pool layers WITHIN it, never beyond. Flag
 * off (or a product the city doesn't stock) ⇒ the bare walked quote, unchanged.
 */
export function cityPrice(state: GameState, cityId: string, productId: ProductId): number {
  const book = state.tradeCities[cityId];
  const walk = book?.pricesByProduct[productId] ?? getProduct(productId).basePrice;
  const stock = book?.pool?.inventory[productId];
  if (stock === undefined) return walk; // no pool, or a product this city doesn't consume
  const mult = poolCoverMult(cityId, productId, stock);
  if (mult === 1) return walk;
  const center = getProduct(productId).basePrice * cityBias(cityId, productId);
  return Math.round(
    Math.max(center * TRADE_PRICE_MIN_MULT, Math.min(center * TRADE_PRICE_MAX_MULT, walk * mult)),
  );
}

/**
 * Move a city's demand-pool stock by `delta` units (a supply shock the pool
 * absorbs): an export ships goods IN (+), a city-purchase draws them OUT (−).
 * No-op when the city has no pool or doesn't consume the product. Pure stock
 * bookkeeping — no money moves here (the trade's cash settled through
 * recordTransaction); the changed cover shows up in the next cityPrice read.
 */
export function feedPool(
  state: GameState,
  cityId: string,
  productId: ProductId,
  delta: number,
): void {
  const pool = state.tradeCities[cityId]?.pool;
  if (!pool || pool.inventory[productId] === undefined) return;
  pool.inventory[productId] = Math.max(0, pool.inventory[productId]! + delta);
}

export interface ExportQuote {
  cityId: TradeCityId;
  price: number; // raw quoted price, cents
  netPrice: number; // after freight, cents
}

/**
 * Commodity desk (docs/design/commodity-market.md): buy goods FROM a trade
 * city into a warehouse at its quoted price plus the same freight the sell
 * side pays. Storage is the position limit; money books as importPurchase
 * (firm → world) so conservation holds. Returns units actually bought.
 */
export function performCityPurchase(
  state: GameState,
  firmId: FirmId,
  facilityId: FacilityId,
  productId: ProductId,
  quantity: number,
  cityId: string = 'port_rosa',
): number {
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const firm = townOf(state).firms[firmId];
  const fac = townOf(state).facilities[facilityId];
  if (!firm || !fac || fac.ownerFirmId !== firmId || fac.type !== 'warehouse') return 0;
  const product = getProduct(productId);
  const room =
    fac.storageCapacity - totalUnits(fac.inputInventory) - totalUnits(fac.outputInventory);
  const qty = Math.min(Math.max(0, Math.round(quantity)), Math.max(0, room));
  if (qty <= 0) return 0;
  const unitCost = Math.round(
    impactedFillPrice(cityPrice(state, cityId, productId), qty, 1) *
      (1 + exportFreightFee(state, cityId)),
  );
  const cost = unitCost * qty;
  if (firm.cash < cost) {
    emitEvent(state, 'danger', 'player',
      `Cannot afford ${qty} ${product.name} from ${getTradeCity(cityId).name} (${formatMoney(cost)}).`, firmId);
    return 0;
  }
  recordTransaction(state, {
    from: firmAccount(firmId),
    to: WORLD_ACCOUNT,
    amount: cost,
    firmId,
    category: 'importPurchase',
    productId,
    quantity: qty,
    note: `Bought ${qty} ${product.name} from ${getTradeCity(cityId).name} @ ${formatMoney(unitCost)}`,
  });
  addStock(fac.inputInventory, productId, qty, product.defaultQuality);
  // A POOLED product draws the buy down the city's larder (durable cover,
  // healed by restock over days); anything else — a plain city, or a
  // raw/intermediate the pool never stocks — takes the classic one-tick
  // impact the walk's center-pull heals. The guard tests the PRODUCT, not
  // just the city: feedPool no-ops on un-pooled products, and skipping the
  // impact there would reopen the riskless cross-city arbitrage the impact
  // exists to prevent (review blocker). Either way buying moves the quote UP.
  if (state.tradeCities[cityId]?.pool?.inventory[productId] !== undefined) {
    feedPool(state, cityId, productId, -qty);
  } else {
    applyPriceImpact(state, cityId, productId, qty, 1);
  }
  if (firmId === state.playerFirmId) state.deskTrades += 1;
  const city = getTradeCity(cityId);
  emitEvent(state, 'success', 'logistics',
    `${city.emoji} Bought ${qty} ${product.name} from ${city.name} at ${formatMoney(unitCost)}/unit (freight in).`, facilityId);
  return qty;
}

/** The best-paying city for a product after freight. */
export function pickBestCity(state: GameState, productId: ProductId): ExportQuote {
  let best: ExportQuote | null = null;
  for (const cid of TRADE_CITY_IDS) {
    const price = cityPrice(state, cid, productId);
    const netPrice = Math.round(price * (1 - exportFreightFee(state, cid)));
    if (!best || netPrice > best.netPrice) best = { cityId: cid, price, netPrice };
  }
  return best!;
}

/**
 * Whether an export to `cityId` rides the region FREIGHT edge (region.md step 4,
 * slice 4) instead of settling instantly. True only when the region flag is live
 * AND the destination is a real SIMULATED partner town (present in `state.towns`)
 * — i.e. the trade city has graduated from a stub pool to a live economy. A stub
 * city (ironvale, absent from `state.towns`), the home town itself, and every
 * flag-off game are all false, so they keep the instant pool path unchanged.
 */
export function isFreightDest(state: GameState, cityId: string): boolean {
  return (
    state.config.regionEnabled && cityId !== HOME_TOWN_ID && state.towns[cityId] !== undefined
  );
}

/**
 * Dispatch a lead-timed freight shipment toward a live partner city (region.md
 * step 4, slice 4). The goods leave the home warehouse NOW (they are in flight —
 * inventory, not money) at TODAY's locked quote; FreightSystem lands them in the
 * partner's larder and settles the payment `FREIGHT_LEAD_DAYS` later. No cash
 * moves at dispatch, so region money is conserved to the cent every day across
 * the whole in-flight window. Returns the expected net revenue on delivery
 * (informational — nothing is booked yet).
 */
function dispatchFreight(
  state: GameState,
  firm: import('../entities/Firm').Firm,
  fac: import('../entities/Facility').Facility,
  productId: ProductId,
  qty: number,
  cityId: string,
  note: string,
): number {
  const product = getProduct(productId);
  const city = getTradeCity(cityId);
  const inInput = getQuantity(fac.inputInventory, productId);
  // Lock TODAY's impacted quote (gross); settlement nets THAT arrival day's
  // freight off it — the price is locked, freight risk stays live (the
  // ForwardSystem idiom). Large orders slide down the impact curve as they fill.
  const priceLocked = Math.round(impactedFillPrice(cityPrice(state, cityId, productId), qty, -1));
  // Blended quality of the shipped stack (rides along for a faithful round-trip).
  const quality =
    inInput > 0 ? getQuality(fac.inputInventory, productId) : getQuality(fac.outputInventory, productId);

  // Pull the goods now (in flight). Input first, then output — the instant path's
  // order, so a partial pull matches byte-for-byte.
  const fromInput = Math.min(qty, inInput);
  if (fromInput > 0) removeStock(fac.inputInventory, productId, fromInput);
  if (qty - fromInput > 0) removeStock(fac.outputInventory, productId, qty - fromInput);

  const dispatchDay = computeTime(state.tick, state.config).day;
  const arrivalDay = dispatchDay + FREIGHT_LEAD_DAYS;
  const shipment: FreightShipment = {
    id: nextId(state.idCounters, 'freight'),
    firmId: firm.id,
    facilityId: fac.id,
    originTownId: HOME_TOWN_ID,
    destTownId: cityId,
    productId,
    qty,
    quality,
    priceLocked,
    dispatchDay,
    arrivalDay,
  };
  state.freight.push(shipment);
  // Goods physically left the warehouse now, so the shipped tally lands at
  // dispatch (revenue lands at arrival, in FreightSystem).
  fac.dailyStats.unitsShipped += qty;
  const netEstimate = Math.round(priceLocked * (1 - exportFreightFee(state, cityId))) * qty;
  emitEvent(state, 'info', 'logistics',
    `${city.emoji} ${note} dispatched to ${city.name}: ${qty} ${product.name} — arriving day ${arrivalDay}, ~${formatMoney(netEstimate)} on delivery (price locked).`, fac.id);
  return netEstimate;
}

/**
 * Export up to `quantity` of a product staged in a warehouse to a trade city
 * at its current price minus freight. Returns the revenue (0 = nothing
 * shipped). Revenue arrives from the world account; money stays conserved.
 */
export function performExport(
  state: GameState,
  firmId: FirmId,
  facilityId: FacilityId,
  productId: ProductId,
  quantity: number,
  note = 'Exported',
  cityId: string = 'port_rosa',
): number {
  const firm = townOf(state).firms[firmId];
  const fac = townOf(state).facilities[facilityId];
  if (!firm || !fac || fac.ownerFirmId !== firmId || fac.type !== 'warehouse') return 0;

  const product = getProduct(productId);
  const city = getTradeCity(cityId);
  const inInput = getQuantity(fac.inputInventory, productId);
  const inOutput = getQuantity(fac.outputInventory, productId);
  const qty = Math.min(Math.max(0, Math.round(quantity)), inInput + inOutput);
  if (qty <= 0) return 0;

  // Region freight edge (region.md step 4, slice 4): an export to a LIVE partner
  // city does NOT settle instantly — the goods leave the warehouse now but ride a
  // lead-timed freight edge, landing in the partner's larder and paying out
  // `FREIGHT_LEAD_DAYS` later at the locked price (FreightSystem). A stub trade
  // city (ironvale, not simulated) and every flag-off game keep the instant path
  // below, byte-identical.
  if (isFreightDest(state, cityId)) {
    return dispatchFreight(state, firm, fac, productId, qty, cityId, note);
  }

  // Fuel spikes hit freight too — the fee scales with transport conditions;
  // large orders slide down the impact curve as they fill.
  const price = impactedFillPrice(cityPrice(state, cityId, productId), qty, -1);
  const revenue = Math.round(qty * price * (1 - exportFreightFee(state, cityId)));

  const fromInput = Math.min(qty, inInput);
  if (fromInput > 0) removeStock(fac.inputInventory, productId, fromInput);
  if (qty - fromInput > 0) removeStock(fac.outputInventory, productId, qty - fromInput);

  recordTransaction(state, {
    from: WORLD_ACCOUNT,
    to: firmAccount(firmId),
    amount: revenue,
    firmId,
    category: 'revenue',
    productId,
    quantity: qty,
    note: `${note} to ${city.name}: ${qty} ${product.name}`,
  });
  fac.dailyStats.unitsShipped += qty;
  fac.dailyStats.revenue += revenue; // exports are the warehouse's earnings
  firm.exportRevenue += revenue;
  firm.exportRevenueByCity[cityId] = (firm.exportRevenueByCity[cityId] ?? 0) + revenue;
  settleExportLanding(state, firmId, cityId, productId, qty);
  emitEvent(state, 'success', 'logistics',
    `${city.emoji} ${note} to ${city.name}: ${qty} ${product.name} for ${formatMoney(revenue)} (after freight).`, fac.id);
  creditRushOrder(state, firmId, productId, qty);
  return revenue;
}

/**
 * Land exported goods into the destination city's larder and tally the player's
 * pool-cover missions. Shared by the INSTANT export path and the freight ARRIVAL
 * path (slice 4), so both move the city's stock and quote identically — only the
 * TIMING differs (instant vs `FREIGHT_LEAD_DAYS` later). No money moves here (the
 * cash settled through recordTransaction); this is pure stock/quote bookkeeping.
 *
 * A POOLED product is absorbed into the city's larder — a durable overhang that
 * depresses the quote for days as consumption works it off; anything else — a
 * plain city, or a raw/intermediate the pool never stocks — takes the classic
 * one-tick glut the walk heals. Product-level guard (a city-level guard silently
 * exempted raw exports from ALL impact — review blocker). Either way it softens.
 */
export function settleExportLanding(
  state: GameState,
  firmId: FirmId,
  cityId: string,
  productId: ProductId,
  qty: number,
): void {
  if (state.tradeCities[cityId]?.pool?.inventory[productId] !== undefined) {
    // Read the pool's cover for this product BEFORE the feed, then feed it. Only
    // the player's own reads-the-ports action is tallied (missions/achievements):
    // shipping into a THIN port (cover under the 🔥 bar) teaches the read, and a
    // shipment that lifts a thin port back over its target buffer is the restore.
    // AI exports never touch these counters. Structurally inert flag-off (no pool).
    if (firmId === state.playerFirmId) {
      const invBefore = state.tradeCities[cityId]!.pool!.inventory[productId]!;
      const coverBefore = poolCoverDays(cityId, productId, invBefore);
      feedPool(state, cityId, productId, qty);
      const coverAfter = poolCoverDays(cityId, productId, state.tradeCities[cityId]!.pool!.inventory[productId]!);
      if (coverBefore < TRADE_POOL_THIN_COVER_DAYS) state.poolFeedsWhileThin += 1;
      if (coverBefore < TRADE_POOL_TARGET_COVER_DAYS && coverAfter >= TRADE_POOL_TARGET_COVER_DAYS) {
        state.poolCoversRestored += 1;
      }
    } else {
      feedPool(state, cityId, productId, qty);
    }
  } else {
    applyPriceImpact(state, cityId, productId, qty, -1);
  }
}

/**
 * Count a player export toward the active rush order (any port qualifies —
 * the buyer charters freight from wherever the goods land) and pay the
 * locked-in bonus the moment the order fills.
 */
export function creditRushOrder(
  state: GameState,
  firmId: FirmId,
  productId: ProductId,
  qty: number,
): void {
  const order = state.rushOrder;
  if (!order || firmId !== state.playerFirmId || productId !== order.productId) return;
  order.filled += qty;
  if (order.filled < order.quantity) return;
  state.rushOrder = null;
  state.rushOrdersCompleted += 1;
  recordTransaction(state, {
    from: WORLD_ACCOUNT,
    to: firmAccount(firmId),
    amount: order.bonusCents,
    firmId,
    category: 'revenue',
    productId,
    quantity: 0, // the shipped units were already booked by their exports
    note: `Rush order bonus: ${order.quantity} ${getProduct(productId).name} delivered on time`,
  });
  const city = getTradeCity(order.cityId);
  emitEvent(state, 'success', 'economy',
    `${city.emoji} Rush order complete — ${city.name}'s buyer pays the ${formatMoney(order.bonusCents)} bonus for ${order.quantity} ${getProduct(productId).name} delivered on time.`);
}
