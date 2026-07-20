/**
 * ServiceContract.ts — a recurring firm-to-firm service subscription.
 *
 * The B2B services channel (design HD3 / docs/design/b2b-services.md). Unlike a
 * logistics Contract — which moves physical goods between two facilities of
 * (usually) the same firm — a ServiceContract is a standing subscription between
 * two DIFFERENT firms: a provider that runs a service facility (a datacenter
 * selling compute seats) and a subscriber that pays per seat per day. The money
 * circulates firm-to-firm (subscriber's serviceExpense = provider's revenue),
 * so it no longer leaks to the world account the way every other non-input cost
 * does today.
 *
 * City-scale only: Village never builds datacenters and never holds a
 * ServiceContract, so `serviceContracts` stays `{}` and the whole channel is
 * inert there (bit-identity preserved).
 */

import type { FirmId } from '../core/Id';

export interface ServiceContract {
  /** 'svc_N'. */
  id: string;
  /** Firm running the datacenter that fulfils this subscription. */
  providerFirmId: FirmId;
  /** Firm paying for (and boosted by) the seats. */
  subscriberFirmId: FirmId;
  /** Which service (only 'compute' ships today; the field generalizes later). */
  serviceId: string;
  /** Seats reserved for the subscriber (drives the daily bill + coverage). */
  seats: number;
  /**
   * Price per seat per day in cents, repriced daily to the provider's current
   * listed price (the utilization walk) so the market is live for everyone,
   * not just fresh signings.
   */
  pricePerSeatDay: number;
}
