/**
 * ContractIndex.ts — per-tick lookup tables over the contract set.
 *
 * The AI-strategy and logistics paths repeatedly ask "which contracts source
 * from this facility / feed this facility / belong to this firm?". Answering
 * each by a full `for (const cid in state.contracts)` scan makes those paths
 * effectively O(firms × contracts) (and the logistics reserve calc a nested
 * O(contracts²)) — a cliff that bites past ~30 firms. This index answers the
 * same questions in O(bucket) by bucketing contract ids up front, ONCE per
 * SimContext (see makeContext).
 *
 * Bit-identity is the contract here: each bucket lists contract ids in exactly
 * the order a `for..in` over `state.contracts` would visit them (object
 * insertion order), so an index-driven scan visits the same contracts in the
 * same order as the scan it replaces. Consuming sites keep every non-key
 * predicate they had (notably `c.active` and product/owner filters) — the
 * index only narrows by the bucketed key, never by anything else.
 *
 * The index lives on the transient SimContext (Maps are fine there; the
 * serializable GameState never holds one). Contracts DO mutate mid-tick — AI
 * firms found/expand chains (adds), repoint sourcing (source key change), and
 * consolidate rivals (owner key change). Adds append (a new contract sorts
 * last in insertion order everywhere, so appending preserves order exactly);
 * a key change re-buckets via a full rebuild, which is trivially identical to
 * a fresh `for..in`. Every mid-tick mutation site keeps the index current, so
 * a later reader (a subsequent firm, the manager desk, logistics) never sees a
 * stale bucket. Between ticks, commands mutate contracts without a live index
 * — that is fine, the next makeContext rebuilds from scratch.
 */

import type { GameState } from './GameState';
import type { Contract } from '../entities/Contract';
import type { ContractId, FacilityId, FirmId } from './Id';

export interface ContractIndex {
  /** contract ids keyed by sourceFacilityId, in insertion order. */
  bySource: Map<FacilityId, ContractId[]>;
  /** contract ids keyed by destinationFacilityId, in insertion order. */
  byDest: Map<FacilityId, ContractId[]>;
  /** contract ids keyed by ownerFirmId, in insertion order. */
  byOwner: Map<FirmId, ContractId[]>;
}

function push(map: Map<string, ContractId[]>, key: string, id: ContractId): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(id);
  else map.set(key, [id]);
}

/**
 * An empty index. Used for a PARTNER town's SimContext (region.md step 4): the
 * partner runs the light PARTNER_SYSTEMS subset, none of whose members read the
 * contract index (its only consumers — LogisticsSystem and the AI operator/
 * finance paths — are all home-only), and the partner mints no contracts, so
 * `reindexContracts`/`addContract` never touch it either. Building the full
 * host-scoped index for the partner was O(host contracts) of pure waste EVERY
 * tick that grew with the HOST's firm count (~15µs/tick at Metropolis vs ~7µs at
 * City) — the O(towns × host-size) accident behind the two-town Metropolis
 * delta overshooting City's. Handing the partner an empty index removes it with
 * zero observable change (the partner never reads the index).
 */
export function emptyContractIndex(): ContractIndex {
  return { bySource: new Map(), byDest: new Map(), byOwner: new Map() };
}

/** Build the index from scratch by scanning contracts in insertion order. */
export function buildContractIndex(state: GameState): ContractIndex {
  const index: ContractIndex = {
    bySource: new Map(),
    byDest: new Map(),
    byOwner: new Map(),
  };
  for (const cid in state.contracts) {
    const c = state.contracts[cid]!;
    push(index.bySource, c.sourceFacilityId, c.id);
    push(index.byDest, c.destinationFacilityId, c.id);
    push(index.byOwner, c.ownerFirmId, c.id);
  }
  return index;
}

/**
 * Register a freshly created contract. A new contract carries the highest
 * `nextId` and is inserted last in `state.contracts`, so appending it to each
 * bucket keeps every bucket in the exact insertion order a rebuild would
 * produce — no rebuild needed on the (common) add path.
 */
export function indexAddContract(index: ContractIndex, c: Contract): void {
  push(index.bySource, c.sourceFacilityId, c.id);
  push(index.byDest, c.destinationFacilityId, c.id);
  push(index.byOwner, c.ownerFirmId, c.id);
}

// Read helpers return the raw id bucket (possibly undefined). Callers resolve
// through state.contracts and apply their own remaining predicates, exactly as
// the loops they replace did — so an empty/absent bucket is a no-op, matching a
// scan that matched nothing.
export function contractsBySource(
  index: ContractIndex,
  facilityId: FacilityId,
): readonly ContractId[] {
  return index.bySource.get(facilityId) ?? EMPTY;
}

export function contractsByDest(
  index: ContractIndex,
  facilityId: FacilityId,
): readonly ContractId[] {
  return index.byDest.get(facilityId) ?? EMPTY;
}

export function contractsByOwner(
  index: ContractIndex,
  firmId: FirmId,
): readonly ContractId[] {
  return index.byOwner.get(firmId) ?? EMPTY;
}

const EMPTY: readonly ContractId[] = Object.freeze([]);
