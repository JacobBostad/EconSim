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
import { worldImportMult, worldTransportMult } from '../data/worldEvents';
import { seasonTransportMult, seasonOf } from '../data/seasons';

/** Value of an internal shipment at today's market price (base as fallback). */
function transferValue(state: SimContext['state'], productId: string, qty: number): number {
  const avg = state.marketStats[productId]?.averagePrice ?? 0;
  const price = avg > 0 ? avg : getProduct(productId).basePrice;
  return Math.round(qty * price);
}

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
      dest.dailyStats.transferInValue += transferValue(state, v.cargo.productId, v.cargo.quantity);
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

    // AI firms brace for winter: in autumn/winter their supply lines run
    // deeper (reorder sooner, hold more) so the 65%-output season doesn't
    // starve their chains. Player contracts are untouched — stockpiling is
    // the player's own call.
    const owner = state.firms[contract.ownerFirmId];
    const season = seasonOf(state);
    const bracing =
      owner?.ownerType === 'ai' && (season === 'autumn' || season === 'winter');
    const reorderPoint = bracing
      ? Math.round(contract.reorderPoint * 1.4)
      : contract.reorderPoint;
    const maxInventory = bracing
      ? Math.round(contract.maxInventory * 1.3)
      : contract.maxInventory;
    if (destHave >= reorderPoint) continue;

    // How much to bring in.
    const room = dest.storageCapacity - totalUnits(dest.inputInventory);
    const want = Math.min(
      contract.targetQuantity,
      maxInventory - destHave,
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
      // Pay the importer up front (cost of goods sold). Tariff events raise it.
      const price =
        Math.round(product.basePrice * IMPORT_MARKUP * worldImportMult(state)) * qty;
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
      // Producers ship finished goods (output inventory). Warehouses are
      // relays: deliveries land in their INPUT inventory, so they ship from
      // whichever bag holds the product — otherwise a warehouse could receive
      // goods but never forward them.
      let bag = source.outputInventory;
      if (
        source.type === 'warehouse' &&
        getQuantity(bag, contract.productId) <= 0 &&
        getQuantity(source.inputInventory, contract.productId) > 0
      ) {
        bag = source.inputInventory;
      }
      const avail = getQuantity(bag, contract.productId);
      qty = Math.min(want, avail);
      if (qty <= 0) continue;
      quality = bag[contract.productId]?.quality ?? product.defaultQuality;
      removeStock(bag, contract.productId, qty);
    }

    source.dailyStats.unitsShipped += qty;
    source.dailyStats.transferOutValue += transferValue(state, contract.productId, qty);

    const dist = distance(source.location, dest.location);
    // Fuel-price events scale the whole shipment cost.
    const transportCost = Math.round(
      (TRANSPORT_FLAT_COST + dist * qty * TRANSPORT_COST_PER_UNIT_DISTANCE) *
        worldTransportMult(state) *
        seasonTransportMult(state),
    );
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
