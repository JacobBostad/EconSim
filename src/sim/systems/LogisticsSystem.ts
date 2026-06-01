/**
 * LogisticsSystem — moves goods between facilities via supply contracts.
 *
 * Each hour, every active contract whose destination input inventory has fallen
 * below its reorder point spawns a shipment (if none is already in flight for
 * it). Shipments travel at vehicleSpeed and, on arrival, deposit cargo into the
 * destination's input inventory and charge a distance-based transport cost.
 *
 * When the source is the external importer, stock is effectively unlimited and
 * the buyer pays the import price (recorded as cost of goods sold) at dispatch.
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { nextId } from '../core/Id';
import { isHourBoundary } from '../core/Tick';
import { distance } from '../entities/Location';
import {
  addStock,
  removeStock,
  getQuantity,
  totalUnits,
} from '../entities/Inventory';
import type { Vehicle } from '../entities/Vehicle';
import { getProduct } from '../data/products';
import {
  IMPORT_MARKUP,
  TRANSPORT_COST_PER_UNIT_DISTANCE,
  TRANSPORT_FLAT_COST,
} from '../data/constants';

export function runLogisticsSystem(ctx: SimContext): void {
  processArrivals(ctx);
  if (isHourBoundary(ctx.state.tick, ctx.config)) {
    processReorders(ctx);
  }
}

function processArrivals(ctx: SimContext): void {
  const { state } = ctx;
  const delivered: string[] = [];
  for (const vid in state.vehicles) {
    const v = state.vehicles[vid]!;
    if (v.status !== 'delivered') continue;
    delivered.push(vid);
    const dest = state.facilities[v.destinationFacilityId];
    if (dest) {
      addStock(dest.inputInventory, v.cargo.productId, v.cargo.quantity, v.cargo.quality);
      dest.dailyStats.unitsReceived += v.cargo.quantity;
    }
    if (v.transportCost > 0) {
      recordTransaction(state, {
        from: firmAccount(v.ownerFirmId),
        to: WORLD_ACCOUNT,
        amount: v.transportCost,
        firmId: v.ownerFirmId,
        category: 'logistics',
        productId: v.cargo.productId,
        quantity: v.cargo.quantity,
        note: 'Transport cost',
      });
    }
  }
  for (const vid of delivered) delete state.vehicles[vid];
}

function processReorders(ctx: SimContext): void {
  const { state } = ctx;
  // Contracts that already have an in-flight shipment.
  const inFlight = new Set<string>();
  for (const vid in state.vehicles) {
    const c = state.vehicles[vid]!.contractId;
    if (c) inFlight.add(c);
  }

  for (const cid in state.contracts) {
    const contract = state.contracts[cid]!;
    if (!contract.active || inFlight.has(cid)) continue;
    const source = state.facilities[contract.sourceFacilityId];
    const dest = state.facilities[contract.destinationFacilityId];
    if (!source || !dest) continue;

    const destHave = getQuantity(dest.inputInventory, contract.productId);
    if (destHave >= contract.reorderPoint) continue;

    // How much to bring in.
    const room = dest.storageCapacity - totalUnits(dest.inputInventory);
    const want = Math.min(
      contract.targetQuantity,
      contract.maxInventory - destHave,
      room,
    );
    if (want <= 0) continue;

    const isImporter = source.type === 'importer';
    const product = getProduct(contract.productId);
    let qty: number;
    let quality: number;

    if (isImporter) {
      qty = want;
      quality = product.defaultQuality;
      // Pay the importer up front (cost of goods sold).
      const price = Math.round(product.basePrice * IMPORT_MARKUP) * qty;
      recordTransaction(state, {
        from: firmAccount(contract.ownerFirmId),
        to: firmAccount(source.ownerFirmId),
        amount: price,
        firmId: contract.ownerFirmId,
        category: 'cogs',
        productId: contract.productId,
        quantity: qty,
        note: `Imported ${qty} ${product.name}`,
      });
    } else {
      const avail = getQuantity(source.outputInventory, contract.productId);
      qty = Math.min(want, avail);
      if (qty <= 0) continue;
      quality = source.outputInventory[contract.productId]?.quality ?? product.defaultQuality;
      removeStock(source.outputInventory, contract.productId, qty);
    }

    source.dailyStats.unitsShipped += qty;

    const dist = distance(source.location, dest.location);
    const transportCost =
      TRANSPORT_FLAT_COST + Math.round(dist * qty * TRANSPORT_COST_PER_UNIT_DISTANCE);
    const ticks = Math.max(1, Math.ceil(dist / ctx.config.vehicleSpeed));

    const vehicle: Vehicle = {
      id: nextId(state.idCounters, 'veh'),
      ownerFirmId: contract.ownerFirmId,
      contractId: contract.id,
      originFacilityId: source.id,
      destinationFacilityId: dest.id,
      cargo: { productId: contract.productId, quantity: qty, quality },
      capacity: contract.targetQuantity,
      currentLocation: { ...source.location },
      targetLocation: { ...dest.location },
      status: 'enroute',
      ticksUntilArrival: ticks,
      transportCost,
    };
    state.vehicles[vehicle.id] = vehicle;
  }
}
