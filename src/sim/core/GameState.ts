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
import type { GameEvent, EventSeverity, EventCategory } from './Events';
import {
  type Transaction,
  type AccountRef,
  type LedgerCategory,
} from './Transactions';
import { Rng } from './Random';
import { computeTime, type GameTime } from './Tick';
import { nextId } from './Id';

export const SAVE_VERSION = 1;

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

  citizens: Record<CitizenId, Citizen>;
  firms: Record<FirmId, Firm>;
  facilities: Record<FacilityId, Facility>;
  vehicles: Record<VehicleId, Vehicle>;
  contracts: Record<ContractId, Contract>;
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
  /** Distant trade cities' per-product export prices (see data/tradeCities). */
  tradeCities: Record<string, { pricesByProduct: Record<ProductId, number> }>;
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
   * Consecutive days the town has met the emigration misery bar (worker-heavy
   * AND deeply unsatisfied). Past the grace period families start leaving;
   * a single day above the bar resets it to zero.
   */
  emigrationPressure: number;
  /** Lifetime households lost to emigration (records/achievements). */
  emigrationDepartures: number;
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
}

export function makeContext(state: GameState): SimContext {
  return {
    state,
    config: state.config,
    rng: new Rng(state),
    time: computeTime(state.tick, state.config),
  };
}

// ---------------------------------------------------------------------------
// Account access
// ---------------------------------------------------------------------------

function getAccountCash(state: GameState, ref: AccountRef): number {
  if (ref.kind === 'world') return state.worldCash;
  if (ref.kind === 'firm') return state.firms[ref.id!]?.cash ?? 0;
  return state.citizens[ref.id!]?.cash ?? 0;
}

function addAccountCash(state: GameState, ref: AccountRef, delta: number): void {
  if (ref.kind === 'world') {
    state.worldCash += delta;
    return;
  }
  if (ref.kind === 'firm') {
    const f = state.firms[ref.id!];
    if (f) f.cash += delta;
    return;
  }
  const c = state.citizens[ref.id!];
  if (c) c.cash += delta;
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

  // Update firm accounting accumulators by category.
  if (input.firmId) {
    const firm = state.firms[input.firmId];
    if (firm) {
      applyToLedger(firm.accounting.lifetime, input.category, amount);
      applyToLedger(firm.accounting.today, input.category, amount);
    }
  }
  if (input.counterparty) {
    const other = state.firms[input.counterparty.firmId];
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

/** Total money across citizens + firms + world (should be constant). */
export function totalMoneySupply(state: GameState): number {
  let sum = state.worldCash;
  for (const id in state.firms) sum += state.firms[id]!.cash;
  for (const id in state.citizens) sum += state.citizens[id]!.cash;
  return sum;
}
