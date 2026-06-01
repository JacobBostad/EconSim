/**
 * constants.ts — Shared economic constants and units.
 *
 * Money is always integer cents internally. Helpers here convert between
 * dollars and cents for data definitions and UI.
 */

/** Cents per dollar. */
export const CENTS = 100;

/** Convert dollars to integer cents. */
export function dollars(value: number): number {
  return Math.round(value * CENTS);
}

/** Quality scale bounds. */
export const MIN_QUALITY = 0;
export const MAX_QUALITY = 100;

/** Reference quality used when comparing/scoring stores. */
export const REFERENCE_QUALITY = 50;

/** Importer sells raw inputs at this multiple of base price (premium sourcing). */
export const IMPORT_MARKUP = 1.5;

/** Per-unit transport cost (cents) component for shipments, times distance. */
export const TRANSPORT_COST_PER_UNIT_DISTANCE = 0.6;
/** Flat transport cost (cents) per shipment. */
export const TRANSPORT_FLAT_COST = dollars(2);

// --- Marketing / brand ---------------------------------------------------
/** Brand points gained per day per $ of ad spend (with diminishing returns). */
export const AD_BRAND_GAIN_PER_DOLLAR = 0.05;
/** Daily multiplicative brand decay (brand fades without spend). */
export const BRAND_DECAY_PER_DAY = 0.03;
/** Max brand a store score can contribute via brand weight. */
export const MAX_BRAND = 100;

// --- R&D / quality -------------------------------------------------------
/** Quality points gained per $1,000 invested, scaled by remaining headroom. */
export const RND_QUALITY_GAIN_PER_1000 = 9;

// --- Finance / loans -----------------------------------------------------
/** A firm may borrow up to this multiple of its net worth (cash + inventory). */
export const LOAN_CREDIT_LIMIT_MULTIPLE = 1.5;
/** Minimum credit line (cents) regardless of net worth. */
export const LOAN_MIN_CREDIT = dollars(5000);
