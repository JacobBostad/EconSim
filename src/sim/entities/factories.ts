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
import { getFacilityDef, facilityRecipesForPreset } from '../data/facilityDefinitions';
import { PRODUCTS, PRODUCT_IDS_BY_PRESET, CONSUMER_PRODUCT_IDS_BY_PRESET } from '../data/products';
import type { SizePreset } from '../core/SimulationConfig';
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
    recipes: facilityRecipesForPreset(def, state.config.sizePreset),
    activeRecipeId: null,
    retailProductIds: [],
    positioning: 'standard',
    operatingCostPerDay: def.maintenanceCostPerDay,
    buildCost: def.buildCost,
    productionProgress: 0,
    status: 'idle',
    bottleneckReason: null,
    dailyStats: emptyFacilityDailyStats(),
    yesterdayStats: emptyFacilityDailyStats(),
    pnlEma: { revenue: 0, cost: 0, net: 0 },
    presentWorkers: 0,
    presentSkill: 0,
    builtAtTick: state.tick,
    crowdByCohort: {},
    crowdTenants: 0,
    level: 1,
    workerCapacity: def.workerCapacity,
    exportOrders: {},
    residentIds: [],
    wholesaleEnabled: true,
  };
  state.facilities[id] = fac;
  const firm = state.firms[ownerFirmId];
  if (firm) firm.facilities.push(id);
  return fac;
}

/**
 * Standard recurring needs for a citizen — generated from each product's
 * needSpec (see entities/Product.ts), in explicit spec `order` so the seeded
 * draw sequence never shifts when products are added. A range draws from the
 * stream; a fixed number (luxury cravings start at 0) consumes no draw —
 * exactly the pattern of the old hand-authored table.
 *
 * `preset` gates the catalog: Village and City draw only the classic specs
 * (order ≤ 6), so their seeded sequence is byte-identical to pre-C1; Metropolis
 * appends the breadth specs AFTER them (order ≥ 7), never disturbing the earlier
 * draws. (The C1 breadth is metropolis-only — see products.ts.)
 */
export function makeCitizenNeeds(rng: Rng, preset: SizePreset): CitizenNeed[] {
  const specced = PRODUCT_IDS_BY_PRESET[preset]
    .map((id) => PRODUCTS[id]!)
    .filter((p) => p.needSpec)
    .sort((a, b) => a.needSpec!.order - b.needSpec!.order);
  return specced.map((p) => {
    const s = p.needSpec!;
    return {
      productId: p.id,
      urgency: typeof s.urgency0 === 'number' ? s.urgency0 : rng.range(s.urgency0[0], s.urgency0[1]),
      urgencyGrowthPerDay: rng.range(s.growthPerDay[0], s.growthPerDay[1]),
      preferredQuantity: s.preferredQuantity,
      maxAffordablePriceMultiplier: rng.range(s.maxPriceMult[0], s.maxPriceMult[1]),
      lastSatisfiedTick: 0,
    };
  });
}

/**
 * Default need used when normalizing old saves that predate a product —
 * the spec's hand-pinned migration values (no rng, so migration stays
 * deterministic and byte-compatible with the historical table).
 */
export function defaultNeedFor(productId: string): CitizenNeed | null {
  const spec = PRODUCTS[productId]?.needSpec;
  if (!spec) return null;
  return {
    productId,
    urgency: spec.migration.urgency,
    urgencyGrowthPerDay: spec.migration.growthPerDay,
    preferredQuantity: spec.preferredQuantity,
    maxAffordablePriceMultiplier: spec.migration.maxPriceMult,
    lastSatisfiedTick: 0,
  };
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
  for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) prefs[pid] = rng.range(0.85, 1.15);
  const cit: Citizen = {
    id,
    name: `${first} ${last}`,
    homeFacilityId,
    employerFirmId: null,
    workplaceFacilityId: null,
    role: 'unemployed',
    wage: 0,
    cash: 0,
    needs: makeCitizenNeeds(rng, state.config.sizePreset),
    preferences: prefs,
    currentLocation: { ...loc },
    targetLocation: { ...loc },
    targetFacilityId: null,
    movementState: 'idle',
    activity: 'home',
    satisfaction: 70,
    employmentStatus: 'unemployed',
    tier: 'worker',
    tierStreak: 0,
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
