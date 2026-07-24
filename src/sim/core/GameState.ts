/**
 * GameState.ts — The complete, serializable simulation state + the per-tick
 * context passed to systems, plus the core helpers for moving money and
 * emitting events.
 *
 * GameState is a plain object graph (no class instances, no Maps/Sets) so it
 * round-trips through JSON for save/load. Static data (products, recipes,
 * facility definitions) is NOT stored here — it lives in /data as code and is
 * referenced by id. This keeps saves small and the rules data-driven.
 */

import type { SimulationConfig } from './SimulationConfig';
import type { Speed } from './Commands';
import type { IdCounters } from './Id';
import type {
  CitizenId,
  FirmId,
  FacilityId,
  VehicleId,
  ContractId,
  ProductId,
  EntityId,
} from './Id';
import type { Citizen } from '../entities/Citizen';
import type { Firm } from '../entities/Firm';
import type { Facility } from '../entities/Facility';
import type { Vehicle } from '../entities/Vehicle';
import type { Contract } from '../entities/Contract';
import type { MarketStat } from '../entities/Market';
import type { TradeCityPool } from '../data/tradePool';
import type { FreightShipment } from '../entities/Freight';
import type { GameEvent, EventSeverity, EventCategory } from './Events';
import {
  type Transaction,
  type AccountRef,
  type LedgerCategory,
} from './Transactions';
import { Rng } from './Random';
import { HOME_TOWN_ID, sortedTownIds, type TownId, type TownRecords } from './Town';
import { computeTime, type GameTime } from './Tick';
import { nextId } from './Id';
import {
  buildContractIndex,
  emptyContractIndex,
  indexAddContract,
  type ContractIndex,
} from './ContractIndex';

export const SAVE_VERSION = 3;

/**
 * Dev/test builds fail loud on invariant violations (a settlement against a
 * dead account); production keeps running. Vite defines import.meta.env.DEV
 * (true under Vitest and `vite dev`, false in a production build); default to
 * strict when the flag is absent so a bare runtime still catches the bug.
 */
const IS_DEV: boolean =
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? true;

export interface PerfMetrics {
  lastTickMs: number;
  avgTickMs: number;
  ticksSimulated: number;
}

/** A world event currently in effect (def lives in data/worldEvents.ts). */
export interface ActiveWorldEvent {
  defId: string;
  startDay: number;
  endDay: number;
}

/**
 * A timed bulk-export contract offered to the player: deliver `quantity`
 * units of the product to the ports (any port — the buyer charters freight
 * from wherever it lands) before `deadlineDay` ends for a cash bonus on top
 * of the normal export revenue. At most one is active at a time.
 */
/**
 * A pre-announced trade shock: the Gazette breaks the news days before a
 * city's price center actually moves, so reading the paper becomes a
 * trading edge (see docs/design/commodity-market.md).
 */
export interface TradeAnnouncement {
  cityId: string;
  productId: ProductId;
  /** Center multiplier while in effect (>1 tender/surge, <1 glut/slump). */
  mult: number;
  announcedDay: number;
  effectDay: number;
  durationDays: number;
}

export interface RushOrder {
  /** Flavor + bonus payer: which city's buyer placed the call. */
  cityId: string;
  productId: ProductId;
  quantity: number;
  filled: number;
  startDay: number;
  /** Last day deliveries count; expires when the next day begins. */
  deadlineDay: number;
  /** Completion bonus in cents, locked at offer time. */
  bonusCents: number;
}

/**
 * A rival's fire-sale offer: a distressed AI puts one of its losing
 * facilities on the block at a discount before closing it. Accepting
 * transfers the building, its crew, and its supply lines to the player.
 * At most one is active at a time.
 */
export interface FacilityOffer {
  facilityId: FacilityId;
  sellerFirmId: FirmId;
  /** Asking price in cents, locked at offer time (75% of build cost). */
  askCents: number;
  startDay: number;
  /** Last day the offer stands; it lapses when the next day begins. */
  deadlineDay: number;
}

/** A permanently unlocked achievement (def lives in data/achievements.ts). */
export interface UnlockedAchievement {
  id: string;
  day: number;
}

/** A completed guided mission (def lives in data/missions.ts). */
export interface CompletedMission {
  id: string;
  day: number;
}

export interface GameState {
  saveVersion: number;
  seed: number;
  /** Which starting scenario built this town (for records/leaderboards). */
  scenarioId: string;
  /** Bounded daily town vitals (population, employment, satisfaction). */
  townHistory: import('../systems/TownStatsSystem').TownDay[];
  /** Live PRNG state (see Random.ts). Part of state for determinism. */
  rngState: number;
  tick: number;
  speed: Speed;
  paused: boolean;
  config: SimulationConfig;

  /**
   * The region's towns, each holding the six town-scoped record families
   * (districts, cohorts, citizens, marketStats, firms, facilities). This is the
   * SERIALIZED home of those records (region.md step 3 endgame). One-town region:
   * only `towns[HOME_TOWN_ID]` exists. The flat `citizens`/`firms`/... fields
   * below are non-enumerable accessor ALIASES onto `towns[HOME_TOWN_ID]`
   * (installed by `installTownAliases`), so writers keep working and only `towns`
   * is written to a save. See core/Town.ts.
   */
  towns: Record<TownId, TownRecords>;

  /** Alias onto `towns[HOME_TOWN_ID].citizens` (non-enumerable; see Town.ts). */
  citizens: Record<CitizenId, Citizen>;
  /** Alias onto `towns[HOME_TOWN_ID].firms` (non-enumerable; see Town.ts). */
  firms: Record<FirmId, Firm>;
  /** Alias onto `towns[HOME_TOWN_ID].facilities` (non-enumerable; see Town.ts). */
  facilities: Record<FacilityId, Facility>;
  vehicles: Record<VehicleId, Vehicle>;
  contracts: Record<ContractId, Contract>;
  /** Standing firm-to-firm service subscriptions (B2B services channel, HD3).
   * Additive field — old/Village saves load with {}, and the channel is inert
   * whenever this is empty. Sorted-key iteration everywhere it is read. */
  serviceContracts: Record<string, import('../entities/ServiceContract').ServiceContract>;
  marketStats: Record<ProductId, MarketStat>;

  /** External-world cash account (utilities, government, outside economy). */
  worldCash: number;

  playerFirmId: FirmId;
  worldFirmId: FirmId;

  events: GameEvent[];
  transactions: Transaction[];
  /** Active world events (booms, droughts, fads...); rolled daily. */
  worldEvents: ActiveWorldEvent[];
  /** Unlocked achievements (permanent). */
  achievements: UnlockedAchievement[];
  /** Completed guided missions (ordered chain; see data/missions.ts). */
  missions: CompletedMission[];
  /** Distant trade cities' per-product export prices (see data/tradeCities).
   * `pool` is the Arc E demand pool (opt-in tradeDemandPoolsEnabled) — present
   * only when the flag was on at creation, so a pinned (flag-off) game
   * serializes exactly the pre-Arc-E book. */
  tradeCities: Record<string, { pricesByProduct: Record<ProductId, number>; pool?: TradeCityPool }>;
  /**
   * In-flight inter-town freight (region.md step 4, slice 4). Each entry is a
   * dated shipment dispatched from home toward a LIVE partner city, settled by
   * `FreightSystem` on its `arrivalDay` (goods land in the partner larder, the
   * locked-price payment settles then). WORLD-scoped (a shipment can cross
   * towns). A SAVE-SHAPE addition kept at SAVE_VERSION 3 (normalize-only): the
   * empty-array default is derivable, so an old save loads with `[]` and is
   * byte-identical — the map-dims precedent. Flag off (or no partner) ⇒ always
   * `[]`, and FreightSystem is a no-op, so every pinned baseline is untouched. */
  freight: FreightShipment[];
  /** Active rush order (timed bulk-export contract), if any. */
  rushOrder: RushOrder | null;
  /** Pre-announced city price shock, if one is pending or in effect. */
  tradeAnnouncement: TradeAnnouncement | null;
  /** Lifetime rush orders completed / let expire (player-facing counters). */
  rushOrdersCompleted: number;
  rushOrdersMissed: number;
  /** Active rival fire-sale offer, if any. */
  facilityOffer: FacilityOffer | null;
  /** Lifetime fire-sale purchases (achievements/records). */
  fireSalesBought: number;
  /** Lifetime commodity-desk purchases from the trade cities (missions). */
  deskTrades: number;
  /**
   * World-scale era player-action tallies (missions/achievements). Each is a
   * plain lifetime counter incremented only on the PLAYER's action, the
   * deskTrades idiom — never read by any sim branch, so they perturb no
   * trajectory. All four are structurally inert in Village: pools and leases
   * only exist with their flags on (off at Village preset), and while a Village
   * player CAN close a forward, the era achievement that reads `forwardsClosed`
   * is itself preset-gated, so the count is never consulted there. Default 0.
   */
  /** Forwards the player closed early at the mark (any P&L) — closed_forward. */
  forwardsClosed: number;
  /** Player spot-exports shipped into a pool city whose cover was below the thin
   * bar (TRADE_POOL_THIN_COVER_DAYS) at ship time — the read_ports mission. */
  poolFeedsWhileThin: number;
  /** Player spot-exports that lifted a pool product from below its target cover
   * (TRADE_POOL_TARGET_COVER_DAYS) to at-or-above it — pool_restored. */
  poolCoversRestored: number;
  /** Premises the player-as-LANDLORD repossessed from an insolvent tenant (the
   * landlord side of the repossession rung) — landlord_repossession. */
  landlordRepossessions: number;
  /**
   * The best PARTNER-freight price the player has ever LOCKED, as a whole-percent
   * of that product's base at the destination city (`round(priceLocked * 100 /
   * base)`), taken across every player freight the FreightSystem settles. It's the
   * region era's arbitrage read made observable: the read-the-market mission reads
   * it above 100 (a Port Rosa freight locked above base), the shock achievement at
   * ≥130 (a 1.3× spike locked in). A max, so a later cheaper freight never lowers a
   * peak already earned — the marketShareByProduct idiom (one signal, tiered bars).
   * Written ONLY on the player's own freight settlement (the deskTrades idiom), so
   * it perturbs no trajectory, and structurally inert in Village: `state.freight`
   * is always empty there (no partner), so FreightSystem never writes it. Default
   * 0 (normalize-only, mirroring the other era tallies). */
  freightBestSpikePct: number;
  /**
   * Consecutive days the town has met the emigration misery bar (worker-heavy
   * AND deeply unsatisfied). Past the grace period families start leaving;
   * a single day above the bar resets it to zero.
   */
  emigrationPressure: number;
  /** Lifetime households lost to emigration (records/achievements). */
  emigrationDepartures: number;
  /** Consecutive days each staple has had no staffed seller (AI founders). */
  marketGapDays: Record<string, number>;
  /** Consecutive days each staple's smoothed town fill-rate has stayed below
   * the under-supply threshold — the city-scale founder signal for an occupied
   * but starved market (Village never accumulates it). */
  marketUndersupplyDays: Record<string, number>;
  /** Day of the last town-wide under-supply founder entry, for the entry
   * rate-limit (0 = none yet). */
  lastUndersupplyEntryDay: number;
  /** Consecutive days town housing occupancy has stayed above the landlord
   * founder's "housing is tight" bar — the city-scale signal that draws a
   * real-estate firm to town (Arc D2, HD4). Village never accumulates it. */
  housingTightDays: number;
  /** Day of the last landlord founder entry, for its entry cooldown (0 = none
   * yet). */
  lastLandlordEntryDay: number;
  /** Consecutive days the median trailing dividend yield across listed firms has
   * stayed above the investor-founder bar — the city-scale signal that draws a
   * holdco to town (Arc D3). City-only: Village/Metropolis never accumulate it. */
  investorSignalDays: number;
  /** Day of the last investor (holdco) founder entry, for its entry rate-limit
   * (0 = none yet). */
  lastInvestorEntryDay: number;
  /** Consecutive days each SERVICE's aggregate uncovered seat demand (desired
   * seats across all firms minus provider capacity) has stayed above the founder
   * bar — the city-scale + servicesEnabled signal that a service provider should
   * move in (Arc D4). Only ever accrued at city scale with the flag on; empty
   * everywhere else. */
  serviceUncoveredDays: Record<string, number>;
  /** Day of the last town-wide service-provider founder entry, for that entry's
   * rate-limit (0 = none yet). */
  lastServiceEntryDay: number;
  /**
   * Share-price displacement per firm: recent trades push the quote away
   * from fair value (marketCap), decaying back daily. Liquidity noise only —
   * valuation marks always use the undisplaced marketCap.
   */
  sharePriceShift: Record<FirmId, number>;
  /** City districts — metadata partition of the map (world-scale, HD6). */
  districts: Record<string, import('../entities/District').District>;
  /** Crowd demographics beyond the simulated cast (world-scale, HD1).
   * Empty at Village size — every Village town behaves exactly as before. */
  cohorts: Record<string, import('../entities/Cohort').Cohort>;
  /** Last lapsed fire sale — that facility cools down before re-listing. */
  lastLapsedFireSale: { facilityId: FacilityId; day: number } | null;

  idCounters: IdCounters;
  selectedEntityId: EntityId | null;

  perf: PerfMetrics;
}

/**
 * SimContext — everything a system needs for one tick. Systems mutate
 * `state` directly (in place) for performance; randomness comes from `rng`.
 */
export interface SimContext {
  state: GameState;
  config: SimulationConfig;
  rng: Rng;
  time: GameTime;
  /**
   * The town this tick's systems operate on (region.md step 3 seam). One-town
   * region: always `HOME_TOWN_ID`. A system reads its town's records through
   * `townOf(ctx.state, ctx.townId)` — the accessor that returns the flat records
   * today and `state.towns[townId]` once the endgame move lands, so a converted
   * call site needs no further edit. See core/Town.ts.
   */
  townId: TownId;
  /**
   * Per-tick contract lookup tables (see ContractIndex.ts). Built once here and
   * kept current by the mid-tick mutation sites so the AI-strategy/logistics
   * paths answer "which contracts source/feed this facility / belong to this
   * firm?" in O(bucket) instead of scanning every contract.
   */
  contractIndex: ContractIndex;
}

export function makeContext(state: GameState, townId: TownId = HOME_TOWN_ID): SimContext {
  // `townId` is the town this context's systems operate on. It defaults to
  // HOME_TOWN_ID, so every pre-region caller (`makeContext(state)`) is
  // byte-identical to before — a one-town region builds exactly today's home
  // context. The TownScheduler (region.md step 4, slice 3) is the first caller
  // to pass a value other than 'home': it builds one context per town in sorted
  // town order, and each town's systems read their own records through
  // `townOf(ctx.state, ctx.townId)`.
  return {
    state,
    config: state.config,
    rng: new Rng(state),
    time: computeTime(state.tick, state.config),
    townId,
    // Home builds the real host-scoped index its AI/logistics systems read; a
    // partner town (region.md step 4) runs none of the index's consumers and
    // mints no contracts, so it gets an empty index instead of paying an
    // O(host-contracts) rebuild every tick for nothing (see emptyContractIndex).
    contractIndex:
      townId === HOME_TOWN_ID ? buildContractIndex(state) : emptyContractIndex(),
  };
}

/**
 * Rebuild the context's contract index from the live contract set. Called by
 * the mid-tick sites that change a contract's source/owner key (repointed
 * sourcing, rival consolidation) or spawn a whole chain (founder entry) — a
 * fresh rebuild is trivially identical to the `for..in` scan it stands in for.
 * Rare enough (at most a handful per tick) that the O(contracts) rebuild never
 * shows up against the O(bucket) reads it protects.
 */
export function reindexContracts(ctx: SimContext): void {
  ctx.contractIndex = buildContractIndex(ctx.state);
}

/**
 * Register a newly created contract in state AND the live index in one step, so
 * mid-tick add sites can't forget to keep the index current. Appending is
 * order-exact (a new contract sorts last everywhere), so no rebuild is needed.
 */
export function addContract(ctx: SimContext, contract: Contract): void {
  ctx.state.contracts[contract.id] = contract;
  indexAddContract(ctx.contractIndex, contract);
}

/**
 * Resolve a firm by id ACROSS the region (the same money-scope boundary the
 * account primitive draws): a firm's accounting-ledger update under
 * recordTransaction must reach the firm wherever it lives, since a partner town's
 * firm transacts through the shared world ledger too. Ids are region-unique (the
 * town factory shares `idCounters`), so the firm lives in at most one town and
 * the sorted scan returns the same object whatever the order. One-town region:
 * `towns.home.firms` IS the flat `state.firms` alias, so this is byte-identical to
 * the pre-region `state.firms[id]` read the ledger update used.
 */
function findFirmRegionWide(state: GameState, firmId: FirmId): Firm | undefined {
  for (const tid of sortedTownIds(state)) {
    const f = state.towns[tid]!.firms[firmId];
    if (f) return f;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Account access
// ---------------------------------------------------------------------------

// The account-resolution primitive under recordTransaction (getAccountCash /
// accountExists / addAccountCash). A money account is resolved by id, and money
// moves between towns, so these are REGION-WIDE reads: they resolve against
// EVERY town's firms, cohorts AND citizens (`state.towns[townId]`, in sorted town
// order), NOT a single town's view. Because entity ids are region-unique (the
// town factory shares the region's `idCounters`), an id lives in at most one
// town, so the scan returns the same holder whatever the town order — sorted only
// pins a deterministic order. One-town region: `sortedTownIds` is `['home']` and
// `towns.home.firms` IS the flat `state.firms` alias, so the outer loop is a
// no-op wrapper and resolution is byte-identical to the pre-region flat read (the
// firm-ledger reads inside recordTransaction resolve the same region-unique firm
// ids). A ref that no town holds reads 0 / does not exist, exactly as the flat
// `?? 0` / `!!` did.
function getAccountCash(state: GameState, ref: AccountRef): number {
  if (ref.kind === 'world') return state.worldCash;
  for (const tid of sortedTownIds(state)) {
    const t = state.towns[tid]!;
    if (ref.kind === 'firm') {
      const f = t.firms[ref.id!];
      if (f) return f.cash;
    } else if (ref.kind === 'cohort') {
      const co = t.cohorts[ref.id!];
      if (co) return co.cashPool;
    } else {
      const c = t.citizens[ref.id!];
      if (c) return c.cash;
    }
  }
  return 0;
}

/**
 * Whether an account reference resolves to a live holder. The world account
 * always exists; a firm/cohort/citizen ref is valid only while that entity is
 * still in state (in ANY town — region-wide, see the primitive's note above). A
 * settlement against a vanished counterparty (a firm deleted mid-day by an
 * acquisition, a citizen who emigrated) must not move money on only one side —
 * see the guard in recordTransaction.
 */
function accountExists(state: GameState, ref: AccountRef): boolean {
  if (ref.kind === 'world') return true;
  for (const tid of sortedTownIds(state)) {
    const t = state.towns[tid]!;
    if (ref.kind === 'firm') {
      if (t.firms[ref.id!]) return true;
    } else if (ref.kind === 'cohort') {
      if (t.cohorts[ref.id!]) return true;
    } else {
      if (t.citizens[ref.id!]) return true;
    }
  }
  return false;
}

function describeAccount(ref: AccountRef): string {
  return ref.kind === 'world' ? 'world' : `${ref.kind}:${ref.id ?? 'null'}`;
}

function addAccountCash(state: GameState, ref: AccountRef, delta: number): void {
  if (ref.kind === 'world') {
    state.worldCash += delta;
    return;
  }
  // Region-wide: credit/debit the holder in whichever town holds this id (ids are
  // region-unique, so at most one). One-town region: only `home` is scanned, and
  // a missing id is a silent no-op — identical to the flat guarded write.
  for (const tid of sortedTownIds(state)) {
    const t = state.towns[tid]!;
    if (ref.kind === 'firm') {
      const f = t.firms[ref.id!];
      if (f) {
        f.cash += delta;
        return;
      }
    } else if (ref.kind === 'cohort') {
      const co = t.cohorts[ref.id!];
      if (co) {
        co.cashPool += delta;
        return;
      }
    } else {
      const c = t.citizens[ref.id!];
      if (c) {
        c.cash += delta;
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// recordTransaction — the single money-movement primitive
// ---------------------------------------------------------------------------

export interface TransactionInput {
  from: AccountRef;
  to: AccountRef;
  amount: number; // positive integer cents
  firmId: FirmId | null;
  category: LedgerCategory;
  productId?: ProductId | null;
  quantity?: number;
  note?: string;
  /**
   * When a single money movement is a different line item for each side
   * (e.g. wholesale: buyer's COGS is the seller's revenue), the counterparty
   * firm's ledger gets the same amount under its own category.
   */
  counterparty?: { firmId: FirmId; category: LedgerCategory };
}

/**
 * Move money and record it. Updates the named firm's accounting accumulators so
 * the books always reconcile with the transaction log. Amount is rounded to an
 * integer cent. Returns the created transaction.
 */
export function recordTransaction(
  state: GameState,
  input: TransactionInput,
): Transaction {
  const amount = Math.round(input.amount);

  // Both accounts must resolve, or money would move on only one side (a mint
  // or burn). This fires when a counterparty died mid-settlement — a firm
  // deleted by an acquisition, a citizen who emigrated. Fail loud in dev so
  // the offending caller is fixed; in production skip the transfer atomically
  // (both sides or neither) and keep the game running rather than corrupting
  // the money supply.
  const fromOk = accountExists(state, input.from);
  const toOk = accountExists(state, input.to);
  if (!fromOk || !toOk) {
    const detail =
      `recordTransaction: unresolved ${!fromOk ? 'from' : 'to'} account ` +
      `(${describeAccount(input.from)} -> ${describeAccount(input.to)}), ` +
      `category '${input.category}', amount ${amount}`;
    if (IS_DEV) throw new Error(detail);
    console.error(detail);
    return {
      id: nextId(state.idCounters, 'txn'),
      tick: state.tick,
      from: input.from,
      to: input.to,
      amount: 0,
      firmId: input.firmId,
      category: input.category,
      productId: input.productId ?? null,
      quantity: input.quantity ?? 0,
      note: input.note ?? '',
    };
  }

  addAccountCash(state, input.from, -amount);
  addAccountCash(state, input.to, amount);

  const txn: Transaction = {
    id: nextId(state.idCounters, 'txn'),
    tick: state.tick,
    from: input.from,
    to: input.to,
    amount,
    firmId: input.firmId,
    category: input.category,
    productId: input.productId ?? null,
    quantity: input.quantity ?? 0,
    note: input.note ?? '',
  };

  // Update firm accounting accumulators by category. Region-wide firm lookup:
  // a partner town's firm ledger must update from its own transactions too (the
  // money-scope boundary the account primitive draws). Byte-identical for home —
  // a home firm id resolves in `towns.home` (sorted first, = the flat alias).
  if (input.firmId) {
    const firm = findFirmRegionWide(state, input.firmId);
    if (firm) {
      applyToLedger(firm.accounting.lifetime, input.category, amount);
      applyToLedger(firm.accounting.today, input.category, amount);
    }
  }
  if (input.counterparty) {
    const other = findFirmRegionWide(state, input.counterparty.firmId);
    if (other) {
      applyToLedger(other.accounting.lifetime, input.counterparty.category, amount);
      applyToLedger(other.accounting.today, input.counterparty.category, amount);
    }
  }

  state.transactions.push(txn);
  if (state.transactions.length > state.config.maxTransactions) {
    state.transactions.splice(
      0,
      state.transactions.length - state.config.maxTransactions,
    );
  }
  return txn;
}

function applyToLedger(
  period: import('../entities/Accounting').AccountingPeriod,
  category: LedgerCategory,
  amount: number,
): void {
  switch (category) {
    case 'revenue':
      period.revenue += amount;
      break;
    case 'cogs':
    case 'importPurchase':
      // Materials bought from the importer are the firm's cost of goods sold.
      period.costOfGoodsSold += amount;
      break;
    case 'wages':
      period.wages += amount;
      break;
    case 'maintenance':
      period.maintenance += amount;
      break;
    case 'logistics':
      period.logisticsCost += amount;
      break;
    case 'variableCost':
      period.variableProductionCost += amount;
      break;
    case 'serviceExpense':
      period.serviceExpense += amount;
      break;
    case 'rentExpense':
      period.rentExpense += amount;
      break;
    case 'marketing':
      period.marketing += amount;
      break;
    case 'rnd':
      period.rnd += amount;
      break;
    case 'interest':
      period.interest += amount;
      break;
    case 'buildSpend':
      period.buildSpend += amount;
      break;
    case 'dividendIn':
      period.dividendIn += amount;
      break;
    case 'dividendOut':
      period.dividendOut += amount;
      break;
    case 'shareBuy':
      period.shareBuy += amount;
      break;
    case 'shareSell':
      period.shareSell += amount;
      break;
    case 'loanDraw':
    case 'loanRepay':
    case 'none':
      // Loan principal movements are balance-sheet, not P&L.
      break;
  }
}

/** True if an account can afford `amount` cents. */
export function canAfford(
  state: GameState,
  ref: AccountRef,
  amount: number,
): boolean {
  return getAccountCash(state, ref) >= amount;
}

// ---------------------------------------------------------------------------
// emitEvent — bounded event log
// ---------------------------------------------------------------------------

export function emitEvent(
  state: GameState,
  severity: EventSeverity,
  category: EventCategory,
  message: string,
  entityId: EntityId | null = null,
): void {
  const time = computeTime(state.tick, state.config);
  state.events.push({
    id: nextId(state.idCounters, 'evt'),
    tick: state.tick,
    day: time.day,
    severity,
    category,
    message,
    entityId,
  });
  if (state.events.length > state.config.maxEvents) {
    state.events.splice(0, state.events.length - state.config.maxEvents);
  }
}

/** Total money across citizens + firms + cohorts + world (constant). */
export function totalMoneySupply(state: GameState): number {
  let sum = state.worldCash;
  // Region-wide money read: conservation sums the WHOLE region's firm, citizen
  // and cohort cash, so it iterates EVERY town's holders (`state.towns[townId]`,
  // in sorted town order) plus the one shared world account — this is the probe's
  // `regionMoneySupply` oracle. Cash is integer cents, so the sum is exact and
  // order-independent; the per-town `for..in` matches the pre-region flat read
  // exactly. One-town region: the outer loop is just `home`, whose records ARE
  // the flat `state.firms` / `.citizens` / `.cohorts` aliases — byte-identical.
  for (const tid of sortedTownIds(state)) {
    const t = state.towns[tid]!;
    for (const id in t.firms) sum += t.firms[id]!.cash;
    for (const id in t.citizens) sum += t.citizens[id]!.cash;
    for (const id in t.cohorts) sum += t.cohorts[id]!.cashPool;
  }
  return sum;
}
