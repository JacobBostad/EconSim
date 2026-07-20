/**
 * ServiceBillingSystem — the daily heartbeat of the B2B services channel (HD3).
 *
 * Runs once per day, in the SYSTEMS order between Rent and Accounting, so the
 * seat bill it charges lands in the same `today` accumulators the Accounting
 * snapshot then closes (exactly like RentSystem). Every step is a deterministic
 * read — sorted-key iteration, no rng — so it never perturbs the shared stream.
 *
 * Each day it:
 *   1. prunes contracts whose provider or subscriber vanished (or whose provider
 *      lost its last datacenter);
 *   2. walks each provider's listed price by utilization (the wholesale-walk
 *      idiom): >85% full creeps it up, <50% eases it down, bounded;
 *   3. lets AI subscribers cancel (5 failing ROI days) and re-sizes survivors,
 *      then lets AI non-subscribers subscribe when the ROI gate clears with
 *      margin — the hysteresis that stops subscribe/cancel flapping;
 *   4. bills one recordTransaction per contract: subscriber serviceExpense →
 *      provider revenue, so the money CIRCULATES firm-to-firm;
 *   5. stamps each firm's serviceBoost for the day (proportional to coverage,
 *      full coverage ⇒ ×1.06), which ProductionSystem reads.
 *
 * Gated on config.servicesEnabled AND non-Village. With the flag off (every
 * pinned baseline) or an empty contract set, it does nothing.
 */

import type { SimContext, GameState } from '../core/GameState';
import type { Firm } from '../entities/Firm';
import type { ServiceContract } from '../entities/ServiceContract';
import { recordTransaction, emitEvent } from '../core/GameState';
import { firmAccount } from '../core/Transactions';
import { nextId } from '../core/Id';
import { isDayBoundary } from '../core/Tick';
import {
  COMPUTE_SERVICE_ID,
  DATACENTER_SEATS_PER_LEVEL,
  SERVICE_BOOST_MULT,
  SERVICE_BASE_PRICE_PER_SEAT_DAY,
  SERVICE_PRICE_MIN,
  SERVICE_PRICE_MAX,
  SERVICE_PRICE_STEP,
  SERVICE_UTIL_RAISE,
  SERVICE_UTIL_LOWER,
  SERVICE_SUBSCRIBE_RATIO,
  SERVICE_CANCEL_DAYS,
  seatDemand,
} from '../data/services';

/** Compute-seat capacity a firm offers (0 if it runs no open datacenter). */
export function computeCapacity(state: GameState, firm: Firm): number {
  let seats = 0;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (fac && fac.type === 'datacenter' && fac.status !== 'closed') {
      seats += DATACENTER_SEATS_PER_LEVEL * fac.level;
    }
  }
  return seats;
}

/** Provider's current listed price per seat/day (cents). */
export function listedComputePrice(firm: Firm): number {
  return firm.servicePriceByService?.[COMPUTE_SERVICE_ID] ?? SERVICE_BASE_PRICE_PER_SEAT_DAY;
}

/** A firm's compute seat demand from its size (see services.seatDemand). */
export function computeSeatDemand(firm: Firm): number {
  return seatDemand(firm.employees.length, firm.facilities.length);
}

/** Trailing gross revenue over the last (up to) 7 completed days, cents. */
function gross7d(firm: Firm): number {
  const hist = firm.accounting.dailyHistory;
  let sum = 0;
  for (let i = Math.max(0, hist.length - 7); i < hist.length; i++) {
    sum += hist[i]!.revenue;
  }
  return sum;
}

/** Weekly cash value of the 6% output lift for a firm grossing `gross7d`. */
function weeklyBoostValue(g7: number): number {
  return g7 * (SERVICE_BOOST_MULT - 1);
}

export function runServiceBillingSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  if (!ctx.config.servicesEnabled || ctx.config.sizePreset === 'village') return;

  const firmIds = Object.keys(state.firms).sort();

  // --- 1) Prune dead contracts ------------------------------------------
  for (const cid of Object.keys(state.serviceContracts).sort()) {
    const c = state.serviceContracts[cid]!;
    const provider = state.firms[c.providerFirmId];
    const subscriber = state.firms[c.subscriberFirmId];
    if (!provider || !subscriber || computeCapacity(state, provider) <= 0) {
      delete state.serviceContracts[cid];
    }
  }

  // --- 2) Provider pricing walk (utilization) ---------------------------
  const capacity: Record<string, number> = {};
  for (const fid of firmIds) {
    const firm = state.firms[fid]!;
    const cap = computeCapacity(state, firm);
    if (cap <= 0) continue;
    capacity[fid] = cap;
    let sold = 0;
    for (const cid in state.serviceContracts) {
      const c = state.serviceContracts[cid]!;
      if (c.providerFirmId === fid) sold += c.seats;
    }
    const util = cap > 0 ? sold / cap : 0;
    let price = listedComputePrice(firm);
    if (util > SERVICE_UTIL_RAISE && price < SERVICE_PRICE_MAX) {
      price = Math.min(SERVICE_PRICE_MAX, Math.round(price * (1 + SERVICE_PRICE_STEP)));
    } else if (util < SERVICE_UTIL_LOWER && price > SERVICE_PRICE_MIN) {
      price = Math.max(SERVICE_PRICE_MIN, Math.round(price * (1 - SERVICE_PRICE_STEP)));
    }
    (firm.servicePriceByService ??= {})[COMPUTE_SERVICE_ID] = price;
  }

  const providerIds = Object.keys(capacity).sort();
  if (providerIds.length === 0) {
    // No provider today: clear boosts and bail (contracts already pruned).
    for (const fid of firmIds) state.firms[fid]!.serviceBoost = 1;
    return;
  }

  // Best provider for a new subscription: cheapest listed price with free
  // capacity, tie broken by firm id. `self` is never its own provider.
  const bestProvider = (used: Record<string, number>, self: string): string | null => {
    let best: string | null = null;
    let bestPrice = Infinity;
    for (const pid of providerIds) {
      if (pid === self) continue;
      if ((capacity[pid]! - (used[pid] ?? 0)) <= 0) continue;
      const price = listedComputePrice(state.firms[pid]!);
      if (price < bestPrice) {
        bestPrice = price;
        best = pid;
      }
    }
    return best;
  };

  // --- 3) Cancel / resize / subscribe -----------------------------------
  // Seats already committed per provider (drives remaining capacity as we go).
  const used: Record<string, number> = {};
  const subscriberOf: Record<string, string> = {}; // subscriberFirmId -> contractId

  // 3a) Cancellations (AI ROI hysteresis). Removing a contract frees capacity
  //     before the resize/subscribe passes reallocate it.
  for (const cid of Object.keys(state.serviceContracts).sort()) {
    const c = state.serviceContracts[cid]!;
    const sub = state.firms[c.subscriberFirmId]!;
    const provider = state.firms[c.providerFirmId]!;
    if (sub.ownerType === 'ai') {
      // Per-seat economics: with the proportional boost, held seats pay off iff
      // the full-coverage value clears the full-demand bill (the ratio is seat-
      // count invariant), so the gate prices the firm's live demand rather than
      // a possibly-truncated allocation — a partial holder whose per-seat value
      // is underwater cancels like anyone else instead of holding forever.
      const weeklyCost = Math.max(c.seats, computeSeatDemand(sub)) * listedComputePrice(provider) * 7;
      if (weeklyBoostValue(gross7d(sub)) < weeklyCost) {
        sub.serviceFailingDays = (sub.serviceFailingDays ?? 0) + 1;
      } else {
        sub.serviceFailingDays = 0;
      }
      if ((sub.serviceFailingDays ?? 0) >= SERVICE_CANCEL_DAYS) {
        sub.serviceFailingDays = 0;
        delete state.serviceContracts[cid];
        emitEvent(state, 'info', 'ai',
          `${sub.name} dropped its compute subscription — the seat bill stopped paying for itself.`, sub.id);
        continue;
      }
    }
    subscriberOf[c.subscriberFirmId] = cid;
  }

  // 3b) Resize survivors + reprice to the provider's current listed price,
  //     honoring capacity in sorted order.
  for (const subId of Object.keys(subscriberOf).sort()) {
    const c = state.serviceContracts[subscriberOf[subId]!]!;
    const provider = state.firms[c.providerFirmId]!;
    c.pricePerSeatDay = listedComputePrice(provider);
    const cap = capacity[c.providerFirmId]!;
    // AI subscriptions track the firm's live seat demand; a player's chosen size
    // is respected (only clamped to the provider's remaining capacity).
    const want = state.firms[subId]!.ownerType === 'ai'
      ? computeSeatDemand(state.firms[subId]!)
      : c.seats;
    const seats = Math.max(0, Math.min(want, cap - (used[c.providerFirmId] ?? 0)));
    if (seats <= 0) {
      delete state.serviceContracts[subscriberOf[subId]!];
      continue;
    }
    c.seats = seats;
    used[c.providerFirmId] = (used[c.providerFirmId] ?? 0) + seats;
  }

  // 3c) New AI subscriptions when the ROI gate clears with margin.
  for (const fid of firmIds) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    if (subscriberOf[fid] !== undefined && state.serviceContracts[subscriberOf[fid]!]) continue;
    const desired = computeSeatDemand(firm);
    if (desired <= 0) continue;
    const providerId = bestProvider(used, fid);
    if (!providerId) continue;
    const provider = state.firms[providerId]!;
    const price = listedComputePrice(provider);
    const seats = Math.min(desired, capacity[providerId]! - (used[providerId] ?? 0));
    if (seats <= 0) continue;
    // Priced on full demand, not the (possibly truncated) allocation: with the
    // proportional boost the per-seat ROI is what matters, and value/cost at
    // full demand equals value/cost of any partial slice of it.
    const weeklyCost = desired * price * 7;
    if (weeklyBoostValue(gross7d(firm)) <= weeklyCost * SERVICE_SUBSCRIBE_RATIO) continue;
    const id = nextId(state.idCounters, 'svc');
    const contract: ServiceContract = {
      id,
      providerFirmId: providerId,
      subscriberFirmId: fid,
      serviceId: COMPUTE_SERVICE_ID,
      seats,
      pricePerSeatDay: price,
    };
    state.serviceContracts[id] = contract;
    used[providerId] = (used[providerId] ?? 0) + seats;
    firm.serviceFailingDays = 0;
    emitEvent(state, 'info', 'ai',
      `${firm.name} subscribed to ${provider.name} compute (${seats} seats) to speed up production.`, firm.id);
  }

  // --- 4) Billing: one transaction per contract, money circulates -------
  for (const cid of Object.keys(state.serviceContracts).sort()) {
    const c = state.serviceContracts[cid]!;
    const amount = c.seats * c.pricePerSeatDay;
    if (amount <= 0) continue;
    recordTransaction(state, {
      from: firmAccount(c.subscriberFirmId),
      to: firmAccount(c.providerFirmId),
      amount,
      firmId: c.subscriberFirmId,
      category: 'serviceExpense',
      counterparty: { firmId: c.providerFirmId, category: 'revenue' },
      note: `Compute: ${c.seats} seats @ ${c.pricePerSeatDay}c/seat`,
    });
  }

  // --- 5) Firm-wide production boost from coverage ----------------------
  const seatsBySubscriber: Record<string, number> = {};
  for (const cid in state.serviceContracts) {
    const c = state.serviceContracts[cid]!;
    seatsBySubscriber[c.subscriberFirmId] = (seatsBySubscriber[c.subscriberFirmId] ?? 0) + c.seats;
  }
  for (const fid of firmIds) {
    const firm = state.firms[fid]!;
    const desired = computeSeatDemand(firm);
    const held = seatsBySubscriber[fid] ?? 0;
    // Coverage pays PROPORTIONALLY: an oversubscribed provider truncates
    // allocations (3b/3c clamp to remaining capacity), and all-or-nothing
    // coverage let a truncated subscriber pay daily for seats that conferred
    // nothing — forever, since the ROI gates are per-seat-scale-invariant and
    // never fired (review finding). Every billed seat now maps to its fraction
    // of the lift; full coverage is exactly SERVICE_BOOST_MULT as designed.
    firm.serviceBoost =
      desired > 0 && held > 0
        ? 1 + (SERVICE_BOOST_MULT - 1) * Math.min(1, held / desired)
        : 1;
  }
}
