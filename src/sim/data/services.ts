/**
 * services.ts — the B2B service catalog + its tuned constants.
 *
 * TWO services ship (Arc D4): datacenter COMPUTE (a firm-wide production lift)
 * and office CONSULTING (a firm-wide brand-per-ad-dollar lift). Both are authored
 * as data — a service id, a provider facility type, a seat-capacity rule, a
 * daily benefit — so the billing engine iterates the catalog generically and a
 * third service is a new entry here plus a facility def, not an engine change.
 *
 * The two services prove the channel generalizes across DIFFERENT daily
 * multipliers: compute feeds ProductionSystem's `efficiency`, consulting feeds
 * MarketingSystem's ad→brand gain — neither touches the other, and each billed
 * seat maps to its own fraction of its own benefit.
 *
 * Every constant carries its pinning measurement (see the b2b-services probes and
 * docs/design/b2b-services.md). All prices are integer cents.
 */

import { dollars } from './constants';
import type { FacilityType } from '../entities/Facility';
import type { FacilityDefId } from '../core/Id';

export const COMPUTE_SERVICE_ID = 'compute';
export const CONSULTING_SERVICE_ID = 'consulting';

/** Seats a datacenter offers per upgrade level (a L1 datacenter sells 40). */
export const DATACENTER_SEATS_PER_LEVEL = 40;
/** Advisory seats an office offers per upgrade level (a L1 office sells 24 —
 * fewer than a datacenter: one L1 office serves ~5 chain firms' advisory needs,
 * and the office is the cheaper, lighter facility). */
export const OFFICE_SEATS_PER_LEVEL = 24;

/**
 * Full-coverage COMPUTE production multiplier — a subscriber whose reserved seats
 * meet its seat demand runs every producing facility 6% faster firm-wide.
 *
 * Pinned at 1.06 by the b2b-services probe (300d city, seeds 11/4/7): at this
 * value the ROI gate clears for the bulk of solvent AI producers — measured
 * adoption is a clear majority of eligible AI firms by day 300 — and subscribers
 * out-produce non-subscribers by a visible margin, while the boost stays small
 * enough that a lapsed subscription is a real setback rather than a death knell.
 * Below ~1.04 adoption collapses (the seat bill outweighs the gain); much above
 * ~1.08 it becomes a must-buy that flattens the choice.
 */
export const SERVICE_BOOST_MULT = 1.06;

/**
 * Full-coverage CONSULTING benefit (Arc D4) — a covered firm builds brand 10%
 * faster per ad dollar (MarketingSystem multiplies its ad→brand gain by this).
 * The benefit is deliberately margin-side, NOT production: it is the "reduced ad
 * spend for the same brand effect" wire, valued in the ROI gate as the extra
 * brand-building the same ad budget now buys (ad-dollar equivalent).
 *
 * Pinned at 1.10 by the b2b-services-d4 probe (300d city, seeds 11/4/7): at this
 * value a meaningful minority of the AI firms that actually advertise adopt
 * consulting by day 300 (measured adoption pinned in the probe), the office
 * provider stays solvent, and the value stays small enough that a lapse is a
 * setback, not fatal — the same discipline as the compute boost, one notch
 * higher because ad budgets are smaller than gross revenue so a thinner lift
 * would never clear the seat bill.
 */
export const CONSULTING_BRAND_MULT = 1.1;

/**
 * A firm's seat demand for ANY service: one seat per 4 employees (rounded up)
 * plus one per facility it operates. A small chain (≈5 staff, 3 facilities) wants
 * ≈5 seats; a sprawling firm wants proportionally more, so the bill scales with
 * the size of the operation the benefit accelerates. Shared across services —
 * compute and consulting both size demand off the operation, not the service.
 */
export function seatDemand(employees: number, facilityCount: number): number {
  return Math.ceil(employees / 4) + facilityCount;
}

/**
 * COMPUTE provider listed price walk (cents/seat/day). Starts at $2.00;
 * utilization above 85% creeps it up, below 50% eases it down, bounded to
 * [$0.50, $6.00]. The band is set so a typical subscriber's weekly seat bill
 * sits well under the weekly value of a 6% output lift, leaving the ROI gate a
 * genuine margin to clear.
 */
export const SERVICE_BASE_PRICE_PER_SEAT_DAY = dollars(2.0);
export const SERVICE_PRICE_MIN = dollars(0.5);
export const SERVICE_PRICE_MAX = dollars(6.0);
export const SERVICE_PRICE_STEP = 0.03; // ±3%/day, the wholesale-walk idiom
export const SERVICE_UTIL_RAISE = 0.85; // utilization above this: raise price
export const SERVICE_UTIL_LOWER = 0.5; // below this: lower price

/**
 * CONSULTING provider listed price walk (cents/seat/day). Cheaper than compute —
 * advisory is a lighter product and the brand benefit is valued off (smaller) ad
 * budgets, so the seat bill must sit under the weekly ad-dollar value of a 10%
 * brand lift. Starts at $1.20, bounded [$0.40, $3.50]; same ±3% walk cadence and
 * the same 85%/50% utilization thresholds as compute.
 */
export const CONSULTING_BASE_PRICE_PER_SEAT_DAY = dollars(1.2);
export const CONSULTING_PRICE_MIN = dollars(0.4);
export const CONSULTING_PRICE_MAX = dollars(3.5);

/**
 * Subscribe when the weekly value of the benefit exceeds the weekly seat bill by
 * this margin; cancel when the value falls under the bill for SERVICE_CANCEL_DAYS
 * running. The gap between 1.3× (buy) and 1.0× (start counting a failing day)
 * plus the 5-day cancel delay is the hysteresis band that stops a firm hovering
 * at the break-even line from subscribing and cancelling day after day. Shared by
 * both services — the hysteresis discipline is service-independent.
 */
export const SERVICE_SUBSCRIBE_RATIO = 1.3;
export const SERVICE_CANCEL_DAYS = 5;

/** Which daily multiplier a service's coverage feeds. `production` stamps the
 * firm's `serviceBoost` (read by ProductionSystem); `brand` stamps its
 * `advisoryBoost` (read by MarketingSystem). New benefits add a case in the
 * billing stamp + the consuming system — the catalog stays the source of truth. */
export type ServiceBenefit = 'production' | 'brand';

/**
 * One catalog entry — everything the generic billing engine and the service
 * archetype need to run a service without knowing which service it is.
 */
export interface ServiceDef {
  id: string;
  /** The facility type that provides this service (a provider "runs" one). */
  facilityType: FacilityType;
  /** Its buildable definition id (BUILD_FACILITY / buildableDefs gate on it). */
  facilityDefId: FacilityDefId;
  /** Seats one such facility offers per upgrade level. */
  seatsPerLevel: number;
  /** Listed-price walk parameters (cents/seat/day). */
  basePricePerSeatDay: number;
  priceMin: number;
  priceMax: number;
  priceStep: number;
  utilRaise: number;
  utilLower: number;
  /** ROI hysteresis band (shared values today, but per-service so a future
   * service can tune its own). */
  subscribeRatio: number;
  cancelDays: number;
  /** Which daily multiplier full coverage feeds, and how large the lift is. */
  benefit: ServiceBenefit;
  boostMult: number;
  /** Human label for event text ("compute" / "advisory"). */
  label: string;
}

export const SERVICES: Record<string, ServiceDef> = {
  [COMPUTE_SERVICE_ID]: {
    id: COMPUTE_SERVICE_ID,
    facilityType: 'datacenter',
    facilityDefId: 'datacenter',
    seatsPerLevel: DATACENTER_SEATS_PER_LEVEL,
    basePricePerSeatDay: SERVICE_BASE_PRICE_PER_SEAT_DAY,
    priceMin: SERVICE_PRICE_MIN,
    priceMax: SERVICE_PRICE_MAX,
    priceStep: SERVICE_PRICE_STEP,
    utilRaise: SERVICE_UTIL_RAISE,
    utilLower: SERVICE_UTIL_LOWER,
    subscribeRatio: SERVICE_SUBSCRIBE_RATIO,
    cancelDays: SERVICE_CANCEL_DAYS,
    benefit: 'production',
    boostMult: SERVICE_BOOST_MULT,
    label: 'compute',
  },
  [CONSULTING_SERVICE_ID]: {
    id: CONSULTING_SERVICE_ID,
    facilityType: 'office',
    facilityDefId: 'office',
    seatsPerLevel: OFFICE_SEATS_PER_LEVEL,
    basePricePerSeatDay: CONSULTING_BASE_PRICE_PER_SEAT_DAY,
    priceMin: CONSULTING_PRICE_MIN,
    priceMax: CONSULTING_PRICE_MAX,
    priceStep: SERVICE_PRICE_STEP,
    utilRaise: SERVICE_UTIL_RAISE,
    utilLower: SERVICE_UTIL_LOWER,
    subscribeRatio: SERVICE_SUBSCRIBE_RATIO,
    cancelDays: SERVICE_CANCEL_DAYS,
    benefit: 'brand',
    boostMult: CONSULTING_BRAND_MULT,
    label: 'advisory',
  },
};

/** Catalog service ids in deterministic (sorted) order: 'compute' < 'consulting'.
 * Every generic iteration (billing, boost stamping, the service archetype's
 * per-service passes) walks this so the order is fixed and reproducible. */
export const SERVICE_IDS: string[] = Object.keys(SERVICES).sort();

export function getServiceDef(id: string): ServiceDef {
  const d = SERVICES[id];
  if (!d) throw new Error(`Unknown service: ${id}`);
  return d;
}
