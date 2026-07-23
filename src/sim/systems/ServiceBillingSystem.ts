/**
 * ServiceBillingSystem — the daily heartbeat of the B2B services channel
 * (HD3 compute; Arc D4 makes it catalog-driven for a second service, consulting).
 *
 * Runs once per day, in the SYSTEMS order between Rent and Accounting, so the
 * seat bill it charges lands in the same `today` accumulators the Accounting
 * snapshot then closes (exactly like RentSystem). Every step is a deterministic
 * read — sorted-key iteration, no rng — so it never perturbs the shared stream.
 *
 * It walks the SERVICE catalog in id order ('compute' then 'consulting'). For
 * each service it:
 *   1. prunes that service's contracts whose provider or subscriber vanished (or
 *      whose provider lost its last facility of that service's type);
 *   2. walks each provider's listed price for that service by utilization (the
 *      wholesale-walk idiom): >85% full creeps it up, <50% eases it down, bounded;
 *   3. lets AI subscribers cancel (5 failing ROI days) and re-sizes survivors,
 *      then lets AI non-subscribers subscribe when the ROI gate clears with
 *      margin — the hysteresis that stops subscribe/cancel flapping. SERVICE
 *      archetype firms never subscribe (they are providers, not consumers).
 * Then, once across all services:
 *   4. bills one recordTransaction per contract in (service id, contract id)
 *      order: subscriber serviceExpense → provider revenue, money CIRCULATES;
 *   5. stamps each firm's per-benefit coverage multiplier — compute coverage →
 *      `serviceBoost` (production, read by ProductionSystem), consulting coverage
 *      → `advisoryBoost` (brand, read by MarketingSystem) — proportional to
 *      coverage, full coverage ⇒ the service's boostMult.
 *
 * Gated on config.servicesEnabled AND non-Village. With the flag off (every
 * pinned baseline) or an empty contract set, it does nothing.
 */

import type { SimContext, GameState } from '../core/GameState';
import type { Firm } from '../entities/Firm';
import type { ServiceContract } from '../entities/ServiceContract';
import type { ServiceDef } from '../data/services';
import { recordTransaction, emitEvent } from '../core/GameState';
import { townOf } from '../core/Town';
import { firmAccount } from '../core/Transactions';
import { nextId } from '../core/Id';
import { isDayBoundary } from '../core/Tick';
import {
  SERVICES,
  SERVICE_IDS,
  COMPUTE_SERVICE_ID,
  getServiceDef,
  seatDemand,
} from '../data/services';

// ---------------------------------------------------------------------------
// Generic (catalog-driven) reads
// ---------------------------------------------------------------------------

/** Seat capacity a firm offers for one service (0 if it runs no open facility
 * of that service's type). */
export function serviceCapacity(state: GameState, firm: Firm, def: ServiceDef): number {
  let seats = 0;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (fac && fac.type === def.facilityType && fac.status !== 'closed') {
      seats += def.seatsPerLevel * fac.level;
    }
  }
  return seats;
}

/** A firm's listed price per seat/day for one service (cents). */
export function listedPrice(firm: Firm, def: ServiceDef): number {
  return firm.servicePriceByService?.[def.id] ?? def.basePricePerSeatDay;
}

/** A firm's seat demand from its size (identical across services). */
export function serviceSeatDemand(firm: Firm): number {
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

/** Trailing advertising spend over the last (up to) 7 completed days, cents —
 * the base the consulting brand benefit is valued against. */
function adSpend7d(firm: Firm): number {
  const hist = firm.accounting.dailyHistory;
  let sum = 0;
  for (let i = Math.max(0, hist.length - 7); i < hist.length; i++) {
    sum += hist[i]!.marketing;
  }
  return sum;
}

/**
 * Weekly cash value of full coverage of a service for a subscriber. Compute is
 * valued off gross revenue (the output lift it accelerates); consulting off ad
 * spend (the extra brand the same budget buys, at its ad-dollar equivalent).
 * Both are `base × (boostMult − 1)` — the same idiom, a different base.
 */
function weeklyBenefitValue(firm: Firm, def: ServiceDef): number {
  const base = def.benefit === 'production' ? gross7d(firm) : adSpend7d(firm);
  return base * (def.boostMult - 1);
}

// ---------------------------------------------------------------------------
// Compute-specific wrappers — kept for existing importers (Simulation player
// subscribe path, tests, the C2 probe) so those call sites did not have to move.
// ---------------------------------------------------------------------------

/** Compute-seat capacity a firm offers (0 if it runs no open datacenter). */
export function computeCapacity(state: GameState, firm: Firm): number {
  return serviceCapacity(state, firm, getServiceDef(COMPUTE_SERVICE_ID));
}

/** Provider's current listed compute price per seat/day (cents). */
export function listedComputePrice(firm: Firm): number {
  return listedPrice(firm, getServiceDef(COMPUTE_SERVICE_ID));
}

/** A firm's compute seat demand from its size. */
export function computeSeatDemand(firm: Firm): number {
  return serviceSeatDemand(firm);
}

// ---------------------------------------------------------------------------
// Per-service daily processing (prune → price walk → cancel/resize/subscribe)
// ---------------------------------------------------------------------------

/**
 * Process one service for the day: prune its dead contracts, walk its providers'
 * listed prices, then run the AI cancel/resize/subscribe hysteresis for it. Bills
 * and boosts are NOT done here — those run once across all services afterward, so
 * billing stays in (service id, contract id) order.
 */
function processService(state: GameState, firmIds: string[], def: ServiceDef): void {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const town = townOf(state);
  // --- 1) Prune this service's dead contracts --------------------------------
  for (const cid of Object.keys(state.serviceContracts).sort()) {
    const c = state.serviceContracts[cid]!;
    if (c.serviceId !== def.id) continue;
    const provider = town.firms[c.providerFirmId];
    const subscriber = town.firms[c.subscriberFirmId];
    if (!provider || !subscriber || serviceCapacity(state, provider, def) <= 0) {
      delete state.serviceContracts[cid];
    }
  }

  // --- 2) Provider pricing walk (utilization) --------------------------------
  const capacity: Record<string, number> = {};
  for (const fid of firmIds) {
    const firm = town.firms[fid]!;
    const cap = serviceCapacity(state, firm, def);
    if (cap <= 0) continue;
    capacity[fid] = cap;
    let sold = 0;
    for (const cid in state.serviceContracts) {
      const c = state.serviceContracts[cid]!;
      if (c.serviceId === def.id && c.providerFirmId === fid) sold += c.seats;
    }
    const util = cap > 0 ? sold / cap : 0;
    let price = listedPrice(firm, def);
    if (util > def.utilRaise && price < def.priceMax) {
      price = Math.min(def.priceMax, Math.round(price * (1 + def.priceStep)));
    } else if (util < def.utilLower && price > def.priceMin) {
      price = Math.max(def.priceMin, Math.round(price * (1 - def.priceStep)));
    }
    (firm.servicePriceByService ??= {})[def.id] = price;
  }

  const providerIds = Object.keys(capacity).sort();
  if (providerIds.length === 0) return; // no provider today: contracts already pruned

  // Best provider for a new subscription: cheapest listed price with free
  // capacity, tie broken by firm id. `self` is never its own provider.
  const bestProvider = (used: Record<string, number>, self: string): string | null => {
    let best: string | null = null;
    let bestPrice = Infinity;
    for (const pid of providerIds) {
      if (pid === self) continue;
      if ((capacity[pid]! - (used[pid] ?? 0)) <= 0) continue;
      const price = listedPrice(town.firms[pid]!, def);
      if (price < bestPrice) {
        bestPrice = price;
        best = pid;
      }
    }
    return best;
  };

  // --- 3) Cancel / resize / subscribe (per service) --------------------------
  const used: Record<string, number> = {}; // seats committed per provider this service
  const subscriberOf: Record<string, string> = {}; // subscriberFirmId -> contractId

  // 3a) Cancellations (AI ROI hysteresis).
  for (const cid of Object.keys(state.serviceContracts).sort()) {
    const c = state.serviceContracts[cid]!;
    if (c.serviceId !== def.id) continue;
    const sub = town.firms[c.subscriberFirmId]!;
    const provider = town.firms[c.providerFirmId]!;
    if (sub.ownerType === 'ai') {
      // Per-seat economics: with the proportional benefit, held seats pay off iff
      // the full-coverage value clears the full-demand bill (seat-count invariant),
      // so the gate prices the firm's live demand, not a truncated allocation.
      const weeklyCost = Math.max(c.seats, serviceSeatDemand(sub)) * listedPrice(provider, def) * 7;
      const counter = (sub.serviceFailingDaysByService ??= {});
      if (weeklyBenefitValue(sub, def) < weeklyCost) {
        counter[def.id] = (counter[def.id] ?? 0) + 1;
      } else {
        counter[def.id] = 0;
      }
      if ((counter[def.id] ?? 0) >= def.cancelDays) {
        counter[def.id] = 0;
        delete state.serviceContracts[cid];
        emitEvent(state, 'info', 'ai',
          `${sub.name} dropped its ${def.label} subscription — the seat bill stopped paying for itself.`, sub.id);
        continue;
      }
    }
    subscriberOf[c.subscriberFirmId] = cid;
  }

  // 3b) Resize survivors + reprice to the provider's current listed price.
  for (const subId of Object.keys(subscriberOf).sort()) {
    const c = state.serviceContracts[subscriberOf[subId]!]!;
    const provider = town.firms[c.providerFirmId]!;
    c.pricePerSeatDay = listedPrice(provider, def);
    const cap = capacity[c.providerFirmId]!;
    const want = town.firms[subId]!.ownerType === 'ai'
      ? serviceSeatDemand(town.firms[subId]!)
      : c.seats;
    const seats = Math.max(0, Math.min(want, cap - (used[c.providerFirmId] ?? 0)));
    if (seats <= 0) {
      delete state.serviceContracts[subscriberOf[subId]!];
      continue;
    }
    c.seats = seats;
    used[c.providerFirmId] = (used[c.providerFirmId] ?? 0) + seats;
  }

  // 3c) New AI subscriptions when the ROI gate clears with margin. A SERVICE
  //     archetype firm is a provider, not a consumer — it never subscribes (its
  //     production/brand benefit would be wasted, and cross-provider churn is
  //     noise), so it is skipped here. Operators are unchanged.
  for (const fid of firmIds) {
    const firm = town.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    if (firm.strategy.archetype === 'service') continue;
    if (subscriberOf[fid] !== undefined && state.serviceContracts[subscriberOf[fid]!]) continue;
    const desired = serviceSeatDemand(firm);
    if (desired <= 0) continue;
    const providerId = bestProvider(used, fid);
    if (!providerId) continue;
    const provider = town.firms[providerId]!;
    const price = listedPrice(provider, def);
    const seats = Math.min(desired, capacity[providerId]! - (used[providerId] ?? 0));
    if (seats <= 0) continue;
    const weeklyCost = desired * price * 7;
    if (weeklyBenefitValue(firm, def) <= weeklyCost * def.subscribeRatio) continue;
    const id = nextId(state.idCounters, 'svc');
    const contract: ServiceContract = {
      id,
      providerFirmId: providerId,
      subscriberFirmId: fid,
      serviceId: def.id,
      seats,
      pricePerSeatDay: price,
    };
    state.serviceContracts[id] = contract;
    used[providerId] = (used[providerId] ?? 0) + seats;
    (firm.serviceFailingDaysByService ??= {})[def.id] = 0;
    emitEvent(state, 'info', 'ai',
      `${firm.name} subscribed to ${provider.name} ${def.label} (${seats} seats).`, firm.id);
  }
}

export function runServiceBillingSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  if (!ctx.config.servicesEnabled || ctx.config.sizePreset === 'village') return;
  const town = townOf(state, ctx.townId);

  const firmIds = Object.keys(town.firms).sort();

  // Prune / price-walk / churn each service in catalog (id) order.
  for (const serviceId of SERVICE_IDS) {
    processService(state, firmIds, getServiceDef(serviceId));
  }

  // --- 4) Billing: one transaction per contract, ordered by (serviceId, id).
  //     Money circulates firm-to-firm; nothing leaks to the world account.
  const billOrder = Object.keys(state.serviceContracts).sort((a, b) => {
    const ca = state.serviceContracts[a]!.serviceId;
    const cb = state.serviceContracts[b]!.serviceId;
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const cid of billOrder) {
    const c = state.serviceContracts[cid]!;
    const amount = c.seats * c.pricePerSeatDay;
    if (amount <= 0) continue;
    const label = SERVICES[c.serviceId]?.label ?? c.serviceId;
    recordTransaction(state, {
      from: firmAccount(c.subscriberFirmId),
      to: firmAccount(c.providerFirmId),
      amount,
      firmId: c.subscriberFirmId,
      category: 'serviceExpense',
      counterparty: { firmId: c.providerFirmId, category: 'revenue' },
      note: `${label}: ${c.seats} seats @ ${c.pricePerSeatDay}c/seat`,
    });
  }

  // --- 5) Per-benefit coverage multipliers from each service's coverage -------
  const seatsHeld: Record<string, Record<string, number>> = {}; // serviceId -> firmId -> seats
  for (const cid in state.serviceContracts) {
    const c = state.serviceContracts[cid]!;
    ((seatsHeld[c.serviceId] ??= {})[c.subscriberFirmId] ??= 0);
    seatsHeld[c.serviceId]![c.subscriberFirmId]! += c.seats;
  }
  for (const fid of firmIds) {
    const firm = town.firms[fid]!;
    const desired = serviceSeatDemand(firm);
    // Reset both benefits, then stamp what each service's coverage grants.
    firm.serviceBoost = 1;
    firm.advisoryBoost = 1;
    for (const serviceId of SERVICE_IDS) {
      const def = getServiceDef(serviceId);
      const held = seatsHeld[serviceId]?.[fid] ?? 0;
      // Coverage pays PROPORTIONALLY: an oversubscribed provider truncates
      // allocations (3b/3c clamp to remaining capacity); every billed seat maps
      // to its fraction of the lift, full coverage is exactly the boostMult.
      const mult = desired > 0 && held > 0
        ? 1 + (def.boostMult - 1) * Math.min(1, held / desired)
        : 1;
      if (def.benefit === 'production') firm.serviceBoost = mult;
      else if (def.benefit === 'brand') firm.advisoryBoost = mult;
    }
  }
}
