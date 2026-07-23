/**
 * Freight.ts — a dated inter-town shipment (region.md step 4, slice 4).
 *
 * When the region is live, an export dispatched from home toward a PARTNER city
 * (a trade city that is a real simulated town in `state.towns`, e.g. `port_rosa`)
 * no longer settles instantly: the goods leave the home warehouse at dispatch and
 * ride a freight edge with a LEAD TIME, arriving `leadDays` later in the partner's
 * larder — and only THEN does the payment settle, at the price locked at dispatch.
 * This is the `ForwardSystem` shape (a dated obligation settled on a future day),
 * reused for physical goods rather than paper.
 *
 * The record is WORLD-scoped (carried on `state.freight`, a plain array). In-flight
 * goods are INVENTORY, not money: no cash moves between dispatch and arrival, so
 * region money is conserved to the cent every day across the whole in-flight
 * window (the buyer — the trade-city pool, an external-economy account behind the
 * live partner's larder — pays via the single world account on arrival, exactly as
 * an instant export does, just deferred). See `systems/FreightSystem.ts`.
 */

import type { FirmId, FacilityId, ProductId } from '../core/Id';
import type { TownId } from '../core/Town';

export interface FreightShipment {
  /** Region-unique id (`freight_N`, off the shared idCounters). */
  id: string;
  /** The exporting firm — paid on arrival (origin town). */
  firmId: FirmId;
  /** The origin warehouse the goods shipped from (stats attribution). */
  facilityId: FacilityId;
  /** Where the shipment departs (the home town in slice 4). */
  originTownId: TownId;
  /** The partner city it is bound for (a live town id == its trade-city id). */
  destTownId: TownId;
  productId: ProductId;
  qty: number;
  /** Blended quality of the shipped stack (informational; the pool larder tracks
   * units only, so this rides along for a faithful round-trip). */
  quality: number;
  /** The GROSS impacted unit price locked at dispatch (cents). Settlement nets
   * that day's freight off this — freight risk stays live (the ForwardSystem
   * idiom), the price does not. */
  priceLocked: number;
  dispatchDay: number;
  /** dispatchDay + leadDays — the day FreightSystem lands + pays it. */
  arrivalDay: number;
}
