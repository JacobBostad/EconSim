/**
 * ai/ServiceBehavior.ts — the "service" firm archetype (Arc D4). A service firm's
 * whole business is selling seats: it runs one or more service facilities (a
 * datacenter selling compute, an office selling advisory) and its daily loop is a
 * PROVIDER loop, not a shopkeeper's. It:
 *   - ENTERS a service under tight town-wide utilization (the C2 entry logic,
 *     lifted from expansion.ts's `maybeBuildDatacenter` seam and generalized to
 *     the catalog — this is where operators used to opportunistically build a
 *     datacenter; now the archetype owns provisioning);
 *   - EXPANDS its own capacity (level upgrade, else a second site) when its own
 *     seats have run persistently full;
 *   - holds a CASH BUFFER sized to its facilities' maintenance before any capital
 *     spend, so a subscription lull doesn't bankrupt it.
 *
 * Pricing (the utilization walk) and billing stay in ServiceBillingSystem, which
 * runs generically over every provider regardless of archetype (the seeded Cirrus
 * provider and any player-built provider are priced/billed there too). This module
 * is only the CAPITAL side — when to build and grow capacity.
 *
 * Deterministic: every gate is a cash / utilization / count condition — NO rng
 * draws — so a service firm never perturbs the shared stream. Doubly gated on the
 * services flag + non-Village scale (both false in every pinned baseline), and
 * only ever runs on a firm whose archetype is 'service', which no pinned baseline
 * ever founds (servicesEnabled is off there).
 */

import type { SimContext, GameState } from '../../core/GameState';
import type { Firm } from '../../entities/Firm';
import type { ServiceDef } from '../../data/services';
import { emitEvent, recordTransaction } from '../../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../../core/Transactions';
import { getFacilityDef } from '../../data/facilityDefinitions';
import { createFacility } from '../../entities/factories';
import { clamp } from '../../../utils/clamp';
import { landCostMultiplier, landValueAt } from '../../core/LandValue';
import { MAX_FACILITY_LEVEL, upgradeCost, upgradeFacility } from '../../core/Upgrades';
import { SERVICE_IDS, getServiceDef } from '../../data/services';
import { serviceCapacity } from '../ServiceBillingSystem';
import type { DigestBuffer } from './digest';

// Each constant pinned by the b2b-services-d4 probe (300d city, seeds 11/4/7).
/** Days of its facilities' maintenance a provider keeps in cash after any capital
 * spend — the "buffer sized to maintenance" the archetype holds. At ~$30–44/day
 * maintenance this is a few-thousand-dollar cushion that carries a provider
 * through a subscription lull; the probe pins every founded provider solvent. */
const SERVICE_BUFFER_DAYS = 120;
/** Town-wide utilization at/above which a service is "tight" enough to warrant a
 * new provider — the lifted datacenter entry signal, generalized. */
const SERVICE_ENTRY_TIGHT_UTIL = 0.9;
/** Providers of one service the town supports before entry stops (per service).
 * Caps the market at a handful of competitors rather than exploding. */
const SERVICE_ENTRY_MAX_PROVIDERS = 4;
/** A provider's OWN utilization at/above which the day counts as "full". */
const SERVICE_EXPAND_UTIL = 0.85;
/** Consecutive full days before a provider expands its own capacity. */
const SERVICE_EXPAND_DAYS = 12;

/** Total daily maintenance across a firm's facilities (cents). */
function firmMaintenance(state: GameState, firm: Firm): number {
  let m = 0;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (fac && fac.status !== 'closed') m += fac.operatingCostPerDay;
  }
  return m;
}

/** The cash a provider insists on keeping after a spend — its maintenance runway.
 * A minimum floor keeps a zero-maintenance edge case from waving spends through. */
function cashBuffer(state: GameState, firm: Firm): number {
  return Math.max(8000_00, firmMaintenance(state, firm) * SERVICE_BUFFER_DAYS);
}

/** Town-wide capacity and sold seats for one service (across all providers). */
function townService(state: GameState, def: ServiceDef): { capacity: number; sold: number; providers: number } {
  let capacity = 0;
  let providers = 0;
  for (const fid in state.firms) {
    const cap = serviceCapacity(state, state.firms[fid]!, def);
    if (cap > 0) { capacity += cap; providers += 1; }
  }
  let sold = 0;
  for (const cid in state.serviceContracts) {
    const c = state.serviceContracts[cid]!;
    if (c.serviceId === def.id) sold += c.seats;
  }
  return { capacity, sold, providers };
}

/** Seats a firm has sold on ITS OWN facilities for one service. */
function firmSold(state: GameState, firmId: string, def: ServiceDef): number {
  let sold = 0;
  for (const cid in state.serviceContracts) {
    const c = state.serviceContracts[cid]!;
    if (c.serviceId === def.id && c.providerFirmId === firmId) sold += c.seats;
  }
  return sold;
}

/**
 * Build one service facility for a firm at a spread-out spot, charging land-
 * adjusted cost. Deterministic placement (indexed by how many the firm already
 * runs). Returns the built facility, or null if it can't afford it with buffer.
 */
function buildServiceFacility(ctx: SimContext, firm: Firm, def: ServiceDef, index: number): boolean {
  const { state } = ctx;
  const facDef = getFacilityDef(def.facilityDefId);
  const loc = {
    x: clamp(46 + index * 12, 8, state.config.mapWidth - 8),
    y: clamp(def.facilityType === 'datacenter' ? 38 : 44, 8, state.config.mapHeight - 8),
  };
  const cost = Math.round(facDef.buildCost * landCostMultiplier(landValueAt(state, loc)));
  if (firm.cash - cost < cashBuffer(state, firm)) return false;

  const fac = createFacility(state, def.facilityDefId, firm.id, loc, {
    name: `${firm.name.split(' ')[0]} ${def.facilityType === 'datacenter' ? 'Compute' : 'Advisory'} ${index + 1}`,
  });
  fac.buildCost = cost;
  fac.operatingCostPerDay = Math.round(facDef.maintenanceCostPerDay * landCostMultiplier(landValueAt(state, loc)));
  recordTransaction(state, {
    from: firmAccount(firm.id), to: WORLD_ACCOUNT, amount: cost,
    firmId: firm.id, category: 'buildSpend', note: `Built ${facDef.name}`,
  });
  return true;
}

/**
 * Found the first facility for a freshly-founded service firm (called by the
 * founder row). Exposed so founding and the daily loop share one build path.
 */
export function foundServiceFacility(ctx: SimContext, firmId: string, serviceId: string): boolean {
  const firm = ctx.state.firms[firmId]!;
  return buildServiceFacility(ctx, firm, getServiceDef(serviceId), 0);
}

/**
 * Enter a service the firm does NOT yet provide, when the town's demand for it is
 * tight and the market isn't already crowded. The lifted C2 datacenter-entry
 * gate, generalized: cash (with buffer) + town utilization + provider cap.
 */
function maybeEnterService(ctx: SimContext, firm: Firm, def: ServiceDef): boolean {
  const { state } = ctx;
  if (serviceCapacity(state, firm, def) > 0) return false; // already provides it
  const { capacity, sold, providers } = townService(state, def);
  if (providers >= SERVICE_ENTRY_MAX_PROVIDERS) return false;
  const util = capacity > 0 ? sold / capacity : 1; // no capacity yet ⇒ treat as tight
  if (util < SERVICE_ENTRY_TIGHT_UTIL) return false;
  // Count only the firm's EXISTING service sites for placement spread.
  let owned = 0;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (fac && fac.type === def.facilityType) owned += 1;
  }
  if (!buildServiceFacility(ctx, firm, def, owned)) return false;
  emitEvent(state, 'info', 'ai',
    `🖥️ ${firm.name} opened a new ${def.label} provider for the city's firms.`, firm.id);
  return true;
}

/** Advance a provider's per-service full-day streak from today's own utilization
 * (a "full" day is own-util ≥ SERVICE_EXPAND_UTIL). Returns the new streak. Runs
 * every day for every service the firm provides, independent of whether it acts. */
function trackFullDay(state: GameState, firm: Firm, def: ServiceDef): number {
  const cap = serviceCapacity(state, firm, def);
  const streak = (firm.serviceFullDaysByService ??= {});
  if (cap <= 0) { streak[def.id] = 0; return 0; }
  const util = firmSold(state, firm.id, def) / cap;
  streak[def.id] = util >= SERVICE_EXPAND_UTIL ? (streak[def.id] ?? 0) + 1 : 0;
  return streak[def.id]!;
}

/**
 * Expand OWN capacity for a service the firm already provides, once its own seats
 * have run persistently full. Prefer a level upgrade (cheaper per seat); if every
 * facility is maxed, add a second site. Reads (does not advance) the full-day
 * streak — trackFullDay owns advancing it.
 */
function maybeExpandCapacity(ctx: SimContext, firm: Firm, def: ServiceDef): boolean {
  const { state } = ctx;
  const cap = serviceCapacity(state, firm, def);
  if (cap <= 0) return false;
  const streak = firm.serviceFullDaysByService?.[def.id] ?? 0;
  if (streak < SERVICE_EXPAND_DAYS) return false;
  const clearStreak = (): void => { (firm.serviceFullDaysByService ??= {})[def.id] = 0; };

  // Prefer upgrading a not-yet-maxed facility of this service.
  let owned = 0;
  let upgradable: string | null = null;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== def.facilityType) continue;
    owned += 1;
    if (fac.level < MAX_FACILITY_LEVEL && upgradable === null) upgradable = facId;
  }
  if (upgradable !== null) {
    const cost = upgradeCost(state, upgradable);
    if (firm.cash - cost < cashBuffer(state, firm)) return false;
    if (upgradeFacility(state, firm.id, upgradable)) {
      clearStreak();
      return true;
    }
    return false;
  }
  // All maxed: add a second site (respecting the buffer inside buildServiceFacility).
  if (buildServiceFacility(ctx, firm, def, owned)) {
    clearStreak();
    emitEvent(state, 'info', 'ai',
      `🖥️ ${firm.name} opened another ${def.label} site — its seats were running full.`, firm.id);
    return true;
  }
  return false;
}

/**
 * Run one 'service' firm's daily provider loop. Walks the catalog in id order;
 * for each service the firm either expands (if it provides it) or considers
 * entering (if it doesn't). At most one capital action per firm per day keeps the
 * town's service market growing steadily rather than in bursts.
 */
export function runServiceBehavior(
  ctx: SimContext,
  firmId: string,
  _digest: DigestBuffer | undefined,
): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.bankruptcyStatus === 'insolvent') return;

  // Advance every provided service's full-day streak first (independent of any
  // spending), so persistence accrues even on a day the firm takes another action.
  for (const serviceId of SERVICE_IDS) {
    trackFullDay(state, firm, getServiceDef(serviceId));
  }

  // Then at most one capital action per day: expand a provided service that's run
  // persistently full, else enter a tight service the firm doesn't yet provide.
  for (const serviceId of SERVICE_IDS) {
    const def = getServiceDef(serviceId);
    if (serviceCapacity(state, firm, def) > 0) {
      if (maybeExpandCapacity(ctx, firm, def)) return;
    } else if (firm.bankruptcyStatus === 'healthy') {
      if (maybeEnterService(ctx, firm, def)) return;
    }
  }
}
