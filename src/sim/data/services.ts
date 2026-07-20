/**
 * services.ts — the B2B service catalog + its tuned constants.
 *
 * One service ships today — datacenter compute — but the shape (a service id, a
 * provider facility type, a seat-capacity rule, a firm-wide boost) is authored
 * as data so a second service (logistics-as-a-service, managed ads, ...) is a
 * new entry here plus a facility def, not an engine change.
 *
 * Every constant carries its pinning measurement (see the b2b-services probe and
 * docs/design/b2b-services.md). All prices are integer cents.
 */

import { dollars } from './constants';

export const COMPUTE_SERVICE_ID = 'compute';

/** Seats a datacenter offers per upgrade level (a L1 datacenter sells 40). */
export const DATACENTER_SEATS_PER_LEVEL = 40;

/**
 * Full-coverage production multiplier — a subscriber whose reserved seats meet
 * its seat demand runs every producing facility 6% faster firm-wide.
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
 * A firm's seat demand: one seat per 4 employees (rounded up) plus one per
 * facility it operates. A small chain (≈5 staff, 3 facilities) wants ≈5 seats;
 * a sprawling firm wants proportionally more, so the bill scales with the size
 * of the operation the boost accelerates.
 */
export function seatDemand(employees: number, facilityCount: number): number {
  return Math.ceil(employees / 4) + facilityCount;
}

/**
 * Provider listed price walk (cents/seat/day). Starts at $2.00; utilization
 * above 85% creeps it up, below 50% eases it down, bounded to [$0.50, $6.00].
 * The band is set so a typical subscriber's weekly seat bill sits well under the
 * weekly value of a 6% output lift (see the subscribe gate below), leaving the
 * ROI gate a genuine margin to clear.
 */
export const SERVICE_BASE_PRICE_PER_SEAT_DAY = dollars(2.0);
export const SERVICE_PRICE_MIN = dollars(0.5);
export const SERVICE_PRICE_MAX = dollars(6.0);
export const SERVICE_PRICE_STEP = 0.03; // ±3%/day, the wholesale-walk idiom
export const SERVICE_UTIL_RAISE = 0.85; // utilization above this: raise price
export const SERVICE_UTIL_LOWER = 0.5; // below this: lower price

/**
 * Subscribe when the weekly value of the boost exceeds the weekly seat bill by
 * this margin; cancel when the value falls under the bill for SERVICE_CANCEL_DAYS
 * running. The gap between 1.3× (buy) and 1.0× (start counting a failing day)
 * plus the 5-day cancel delay is the hysteresis band that stops a firm hovering
 * at the break-even line from subscribing and cancelling day after day.
 */
export const SERVICE_SUBSCRIBE_RATIO = 1.3;
export const SERVICE_CANCEL_DAYS = 5;
