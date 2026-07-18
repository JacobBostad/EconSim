/**
 * factories.ts — Runtime entity constructors that mutate GameState.
 *
 * Used by command handling (e.g. BUILD_FACILITY) to add entities consistently
 * with how the starting scenario builds them.
 */

import type { GameState } from '../core/GameState';
import { nextId } from '../core/Id';
import type { FacilityDefId, FirmId, FacilityId } from '../core/Id';
import type { Vec2 } from './Location';
import type { Facility } from './Facility';
import { emptyFacilityDailyStats } from './Facility';
import type { Citizen, CitizenNeed } from './Citizen';
import type { Rng } from '../core/Random';
import { getFacilityDef } from '../data/facilityDefinitions';
import { CONSUMER_PRODUCT_IDS } from '../data/products';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';

export function createFacility(
  state: GameState,
  defId: FacilityDefId,
  ownerFirmId: FirmId,
  location: Vec2,
  opts: { name?: string } = {},
): Facility {
  const def = getFacilityDef(defId);
  const id = nextId(state.idCounters, 'fac');
  const fac: Facility = {
    id,
    defId,
    name: opts.name ?? `${def.name} ${id}`,
    type: def.type,
    ownerFirmId,
    location: { ...location },
    employees: [],
    inputInventory: {},
    outputInventory: {},
    storageCapacity: def.storageCapacity,
    recipes: [...def.allowedRecipes],
    activeRecipeId: null,
    retailProductIds: [],
    operatingCostPerDay: def.maintenanceCostPerDay,
    buildCost: def.buildCost,
    productionProgress: 0,
    status: 'idle',
    bottleneckReason: null,
    dailyStats: emptyFacilityDailyStats(),
    presentWorkers: 0,
    presentSkill: 0,
    builtAtTick: state.tick,
    level: 1,
    workerCapacity: def.workerCapacity,
    exportOrders: {},
    residentIds: [],
  };
  state.facilities[id] = fac;
  const firm = state.firms[ownerFirmId];
  if (firm) firm.facilities.push(id);
  return fac;
}

/** Standard recurring needs for a citizen (same ranges the scenario uses). */
export function makeCitizenNeeds(rng: Rng): CitizenNeed[] {
  return [
    {
      productId: 'bread',
      urgency: rng.range(0.2, 0.9),
      urgencyGrowthPerDay: rng.range(0.55, 0.75),
      preferredQuantity: 2,
      maxAffordablePriceMultiplier: rng.range(1.4, 1.8),
      lastSatisfiedTick: 0,
    },
    {
      productId: 'tools',
      urgency: rng.range(0, 0.4),
      // Durables are wanted every ~4 days; keep demand near what the
      // town's production capacity can actually satisfy (see balance notes).
      urgencyGrowthPerDay: rng.range(0.22, 0.32),
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: rng.range(1.3, 1.6),
      lastSatisfiedTick: 0,
    },
    {
      productId: 'clothes',
      urgency: rng.range(0, 0.5),
      urgencyGrowthPerDay: rng.range(0.2, 0.3),
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: rng.range(1.35, 1.65),
      lastSatisfiedTick: 0,
    },
    // Luxury cravings only grow for satisfied, well-off citizens
    // (gated in SatisfactionSystem).
    {
      productId: 'pastries',
      urgency: 0,
      urgencyGrowthPerDay: rng.range(0.1, 0.18),
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: rng.range(1.2, 1.6),
      lastSatisfiedTick: 0,
    },
    {
      productId: 'jewelry',
      urgency: 0,
      urgencyGrowthPerDay: rng.range(0.03, 0.07),
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: rng.range(1.1, 1.4),
      lastSatisfiedTick: 0,
    },
  ];
}

/**
 * Default need used when normalizing old saves that predate a product
 * (mid-range values, no rng so migration stays deterministic).
 */
export function defaultNeedFor(productId: string): CitizenNeed | null {
  if (productId === 'clothes') {
    return {
      productId: 'clothes',
      urgency: 0.25,
      urgencyGrowthPerDay: 0.21,
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: 1.5,
      lastSatisfiedTick: 0,
    };
  }
  if (productId === 'pastries') {
    return {
      productId: 'pastries',
      urgency: 0,
      urgencyGrowthPerDay: 0.14,
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: 1.4,
      lastSatisfiedTick: 0,
    };
  }
  if (productId === 'jewelry') {
    return {
      productId: 'jewelry',
      urgency: 0,
      urgencyGrowthPerDay: 0.05,
      preferredQuantity: 1,
      maxAffordablePriceMultiplier: 1.25,
      lastSatisfiedTick: 0,
    };
  }
  return null;
}

/** Create a citizen at runtime (used by immigration). Cash starts at 0 —
 * callers move starting cash via recordTransaction so money stays conserved. */
export function createCitizen(
  state: GameState,
  rng: Rng,
  homeFacilityId: FacilityId,
): Citizen {
  const home = state.facilities[homeFacilityId];
  const loc: Vec2 = home ? { ...home.location } : { x: 0, y: 0 };
  const id = nextId(state.idCounters, 'cit');
  const first = rng.pick(FIRST_NAMES) ?? 'Sam';
  const last = rng.pick(LAST_NAMES) ?? 'Doe';
  const prefs: Record<string, number> = {};
  for (const pid of CONSUMER_PRODUCT_IDS) prefs[pid] = rng.range(0.85, 1.15);
  const cit: Citizen = {
    id,
    name: `${first} ${last}`,
    homeFacilityId,
    employerFirmId: null,
    workplaceFacilityId: null,
    role: 'unemployed',
    wage: 0,
    cash: 0,
    needs: makeCitizenNeeds(rng),
    preferences: prefs,
    currentLocation: { ...loc },
    targetLocation: { ...loc },
    targetFacilityId: null,
    movementState: 'idle',
    activity: 'home',
    satisfaction: 70,
    employmentStatus: 'unemployed',
    lastPurchasedFromByProduct: {},
    storeReliability: {},
    dailyStats: { day: 0, wagesEarned: 0, spent: 0, purchases: 0, unmetNeeds: 0 },
    lastShopTick: -1000,
    missedPaydays: 0,
    skill: rng.range(0.85, 1.05),
  };
  state.citizens[id] = cit;
  if (home) home.residentIds.push(id);
  return cit;
}
