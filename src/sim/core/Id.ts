/**
 * Id.ts — Identifier types and deterministic id generation.
 *
 * Ids are plain string aliases (not branded) to keep the codebase ergonomic.
 * Generation is deterministic: it relies only on per-prefix counters stored in
 * GameState, never on Math.random or Date. This is required for determinism.
 */

export type CitizenId = string;
export type FirmId = string;
export type FacilityId = string;
export type VehicleId = string;
export type ContractId = string;
export type ProductId = string;
export type RecipeId = string;
export type FacilityDefId = string;
export type EventId = string;
export type TransactionId = string;

/** Any selectable entity id. */
export type EntityId = CitizenId | FirmId | FacilityId | VehicleId;

/** Counters live inside GameState so id generation survives save/load. */
export type IdCounters = Record<string, number>;

/**
 * Generate the next id for a given prefix, mutating the counters map.
 * Example: nextId(counters, 'cit') -> 'cit_1', 'cit_2', ...
 */
export function nextId(counters: IdCounters, prefix: string): string {
  const current = counters[prefix] ?? 0;
  const next = current + 1;
  counters[prefix] = next;
  return `${prefix}_${next}`;
}
