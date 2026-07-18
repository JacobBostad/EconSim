/**
 * Trade.ts — Port Rosa export execution, shared by the EXPORT_GOODS command
 * and standing export orders (auto-export rules on warehouses).
 */

import type { GameState } from './GameState';
import { emitEvent, recordTransaction } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import type { FirmId, FacilityId, ProductId } from './Id';
import { getProduct } from '../data/products';
import { getQuantity, removeStock } from '../entities/Inventory';
import { EXPORT_FREIGHT_FEE } from '../data/constants';
import { worldTransportMult } from '../data/worldEvents';

/** Freight fee scaled by fuel conditions, capped so exports never go negative-margin by fee alone. */
export function exportFreightFee(state: GameState): number {
  return Math.min(0.5, EXPORT_FREIGHT_FEE * worldTransportMult(state));
}

/**
 * Export up to `quantity` of a product staged in a warehouse to Port Rosa at
 * the current trade price minus freight. Returns the revenue (0 = nothing
 * shipped). Revenue arrives from the world account; money stays conserved.
 */
export function performExport(
  state: GameState,
  firmId: FirmId,
  facilityId: FacilityId,
  productId: ProductId,
  quantity: number,
  note = 'Exported to Port Rosa',
): number {
  const firm = state.firms[firmId];
  const fac = state.facilities[facilityId];
  if (!firm || !fac || fac.ownerFirmId !== firmId || fac.type !== 'warehouse') return 0;

  const product = getProduct(productId);
  const inInput = getQuantity(fac.inputInventory, productId);
  const inOutput = getQuantity(fac.outputInventory, productId);
  const qty = Math.min(Math.max(0, Math.round(quantity)), inInput + inOutput);
  if (qty <= 0) return 0;

  const price = state.tradeCity.pricesByProduct[productId] ?? product.basePrice;
  // Fuel spikes hit sea freight too — the fee scales with transport conditions.
  const revenue = Math.round(qty * price * (1 - exportFreightFee(state)));

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
    note: `${note}: ${qty} ${product.name}`,
  });
  fac.dailyStats.unitsShipped += qty;
  firm.exportRevenue += revenue;
  emitEvent(state, 'success', 'logistics',
    `🚢 ${note}: ${qty} ${product.name} for ${revenue}¢ (after freight).`, fac.id);
  return revenue;
}
