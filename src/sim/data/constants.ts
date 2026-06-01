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
