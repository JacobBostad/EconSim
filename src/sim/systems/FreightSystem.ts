/**
 * FreightSystem — settle dated inter-town freight (region.md step 4, slice 4).
 *
 * The region's freight edge carries goods between two LIVE economies with a LEAD
 * TIME. When home exports to a live partner city (isFreightDest), Trade's
 * `dispatchFreight` pulls the goods from the warehouse NOW and records an in-flight
 * `FreightShipment` on `state.freight`; this system lands + pays it on its
 * `arrivalDay`. It is the `ForwardSystem` shape reused for physical goods: a dated
 * obligation settled at the day boundary, a pure function of state (no rng), so
 * inserting it re-deals nothing.
 *
 * On arrival: the goods land in the partner's larder (the pool interface the
 * design keeps as the freight-facing surface, now moved by a REAL dated shipment
 * from the live home economy) via `settleExportLanding`, and the payment settles
 * THEN — WORLD account → the exporting firm at the LOCKED price, this arrival
 * day's freight netted off (freight risk stays live, the price does not). In-flight
 * goods are INVENTORY, not money: no cash moves between dispatch and arrival, so
 * region money is conserved to the cent every day across the whole in-flight
 * window, and the arrival's single world→firm transfer nets to zero region-wide.
 *
 * Flag off (or no shipments) ⇒ `state.freight` is empty ⇒ this is an early-return
 * no-op that draws no rng and writes nothing — every pinned baseline is untouched.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent, recordTransaction } from '../core/GameState';
import type { FreightShipment } from '../entities/Freight';
import { townOf } from '../core/Town';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { getProduct } from '../data/products';
import { getTradeCity } from '../data/tradeCities';
import { exportFreightFee, settleExportLanding, creditRushOrder } from '../core/Trade';
import { formatMoney } from '../../utils/formatMoney';

export function runFreightSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  // Flag-off / no shipments: a byte-identical no-op (no rng, no writes). This is
  // what keeps every pinned baseline untouched with the system in the list.
  if (state.freight.length === 0) return;

  const day = ctx.time.day;
  // Partition in insertion order (deterministic): the arrived settle, the rest
  // fly on. `arrivalDay` is an ABSOLUTE day, so a save taken mid-flight reloads
  // and still lands each shipment on its scheduled day.
  const arrived: FreightShipment[] = [];
  const stillFlying: FreightShipment[] = [];
  for (const ship of state.freight) {
    (ship.arrivalDay <= day ? arrived : stillFlying).push(ship);
  }
  if (arrived.length === 0) return;
  state.freight = stillFlying;
  for (const ship of arrived) settleFreight(ctx, ship);
}

function settleFreight(ctx: SimContext, ship: FreightShipment): void {
  const { state } = ctx;
  const city = getTradeCity(ship.destTownId);
  const product = getProduct(ship.productId);
  // Locked price, THIS arrival day's freight netted off (ForwardSystem idiom).
  const net = Math.round(ship.priceLocked * (1 - exportFreightFee(state, ship.destTownId)));
  const revenue = net * ship.qty;

  // The goods LAND regardless of the shipper's fate (they were shipped): the
  // stock/quote delta the pool interface already models, now driven by a real
  // dated shipment. Pure stock/quote bookkeeping — no money here.
  settleExportLanding(state, ship.firmId, ship.destTownId, ship.productId, ship.qty);

  const firm = townOf(state, ship.originTownId).firms[ship.firmId];
  if (firm) {
    recordTransaction(state, {
      from: WORLD_ACCOUNT,
      to: firmAccount(ship.firmId),
      amount: revenue,
      firmId: ship.firmId,
      category: 'revenue',
      productId: ship.productId,
      quantity: ship.qty,
      note: `Freight delivered to ${city.name}: ${ship.qty} ${product.name} @ ${formatMoney(net)} locked-net`,
    });
    firm.exportRevenue += revenue;
    firm.exportRevenueByCity[ship.destTownId] =
      (firm.exportRevenueByCity[ship.destTownId] ?? 0) + revenue;
    // The origin warehouse books the earnings on the day they land, mirroring
    // the instant path (Trade.settleExportLanding) so the P&L table sees
    // freight deliveries too. The facility may have been sold mid-flight.
    const fac = townOf(state).facilities[ship.facilityId];
    if (fac) fac.dailyStats.revenue += revenue;
    // Delivery counts toward an active rush order (any port qualifies — the buyer
    // charters freight from wherever the goods land); paid the moment it fills.
    creditRushOrder(state, ship.firmId, ship.productId, ship.qty);
    emitEvent(state, 'success', 'logistics',
      `${city.emoji} Freight delivered to ${city.name}: ${ship.qty} ${product.name} for ${formatMoney(revenue)} (locked price, freight in).`, ship.facilityId);
  } else {
    // The exporter vanished mid-flight (bankruptcy/acquisition): the goods still
    // land, but there is no one to pay — skip the settlement so money is neither
    // minted nor burned. Conservation holds to the cent.
    emitEvent(state, 'info', 'logistics',
      `${city.emoji} Freight to ${city.name} arrived (${ship.qty} ${product.name}) but its shipper is gone — payment forfeited.`);
  }
}
