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
import type { FirmId, FacilityId, ProductId } from './Id';
import { getProduct } from '../data/products';
import { getQuantity, removeStock, addStock, totalUnits } from '../entities/Inventory';
import { EXPORT_FREIGHT_FEE, TRADE_PRICE_MIN_MULT, TRADE_PRICE_MAX_MULT } from '../data/constants';
import { worldTransportMult } from '../data/worldEvents';
import { getTradeCity, TRADE_CITY_IDS, cityBias, type TradeCityId } from '../data/tradeCities';

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

/** A city's quoted price for a product (base price if unknown). */
export function cityPrice(state: GameState, cityId: string, productId: ProductId): number {
  return state.tradeCities[cityId]?.pricesByProduct[productId] ?? getProduct(productId).basePrice;
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
  const firm = state.firms[firmId];
  const fac = state.facilities[facilityId];
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
  applyPriceImpact(state, cityId, productId, qty, 1); // buying moves the quote up
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
  const firm = state.firms[firmId];
  const fac = state.facilities[facilityId];
  if (!firm || !fac || fac.ownerFirmId !== firmId || fac.type !== 'warehouse') return 0;

  const product = getProduct(productId);
  const city = getTradeCity(cityId);
  const inInput = getQuantity(fac.inputInventory, productId);
  const inOutput = getQuantity(fac.outputInventory, productId);
  const qty = Math.min(Math.max(0, Math.round(quantity)), inInput + inOutput);
  if (qty <= 0) return 0;

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
  applyPriceImpact(state, cityId, productId, qty, -1); // a glut softens the quote
  emitEvent(state, 'success', 'logistics',
    `${city.emoji} ${note} to ${city.name}: ${qty} ${product.name} for ${formatMoney(revenue)} (after freight).`, fac.id);
  creditRushOrder(state, firmId, productId, qty);
  return revenue;
}

/**
 * Count a player export toward the active rush order (any port qualifies —
 * the buyer charters freight from wherever the goods land) and pay the
 * locked-in bonus the moment the order fills.
 */
function creditRushOrder(
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
