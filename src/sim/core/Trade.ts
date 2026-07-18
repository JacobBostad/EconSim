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
import { getQuantity, removeStock } from '../entities/Inventory';
import { EXPORT_FREIGHT_FEE } from '../data/constants';
import { worldTransportMult } from '../data/worldEvents';
import { getTradeCity, TRADE_CITY_IDS, type TradeCityId } from '../data/tradeCities';

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

  const price = cityPrice(state, cityId, productId);
  // Fuel spikes hit freight too — the fee scales with transport conditions.
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
