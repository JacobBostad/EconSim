/**
 * facilityDefinitions.ts — Buildable facility templates (data-driven).
 *
 * The BuildPanel reads `BUILDABLE_DEFS` for what the player can construct. To
 * add a new building type, append a FacilityDefinition and (if it produces)
 * reference recipes from recipes.ts.
 */

import type { FacilityDefinition } from '../entities/Facility';
import type { FacilityDefId, RecipeId } from '../core/Id';
import type { SizePreset } from '../core/SimulationConfig';
import { dollars } from './constants';
import { getRecipe } from './recipes';
import { productAvailableInPreset } from './products';

export const FACILITY_DEFS: Record<FacilityDefId, FacilityDefinition> = {
  home: {
    id: 'home',
    name: 'Home',
    type: 'home',
    buildCost: 0,
    maintenanceCostPerDay: 0,
    workerCapacity: 0,
    storageCapacity: 50,
    allowedRecipes: [],
    allowedProductsForSale: [],
    footprint: 1,
    description: 'A residence for citizens.',
  },
  apartment: {
    id: 'apartment',
    name: 'Apartment',
    type: 'home',
    buildCost: dollars(4500),
    maintenanceCostPerDay: dollars(2),
    workerCapacity: 0,
    storageCapacity: 50,
    allowedRecipes: [],
    allowedProductsForSale: [],
    footprint: 1,
    description:
      'Premium housing for 2 citizens. Residents pay daily rent and live happier — and new arrivals need somewhere to live.',
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    type: 'farm',
    buildCost: dollars(2400),
    maintenanceCostPerDay: dollars(8),
    workerCapacity: 5,
    storageCapacity: 200,
    allowedRecipes: ['grow_grain', 'grow_cotton', 'grow_produce', 'tan_leather', 'cut_lumber', 'grow_grapes'],
    allowedProductsForSale: [],
    footprint: 4,
    description: 'Grows grain or cotton — and, in a city, produce, leather, lumber or grapes. Needs workers; no inputs required.',
  },
  mine: {
    id: 'mine',
    name: 'Mine',
    type: 'mine',
    buildCost: dollars(3200),
    maintenanceCostPerDay: dollars(15),
    workerCapacity: 6,
    storageCapacity: 200,
    allowedRecipes: ['mine_minerals'],
    allowedProductsForSale: [],
    footprint: 4,
    description: 'Extracts minerals. Needs workers; no inputs required.',
  },
  factory: {
    id: 'factory',
    name: 'Factory',
    type: 'factory',
    buildCost: dollars(3000),
    maintenanceCostPerDay: dollars(11),
    workerCapacity: 6,
    storageCapacity: 240,
    allowedRecipes: ['bake_bread', 'roast_coffee', 'make_tools', 'sew_clothes', 'bake_pastries', 'craft_jewelry', 'cook_meals', 'make_shoes', 'build_furniture', 'assemble_appliances', 'ferment_wine'],
    allowedProductsForSale: [],
    footprint: 4,
    description:
      'Manufactures goods from inputs: bread, tools, clothes — or luxury pastries and jewelry once your craft quality reaches 75. In a city, also meals, shoes, furniture, appliances and wine.',
  },
  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    type: 'warehouse',
    buildCost: dollars(1500),
    maintenanceCostPerDay: dollars(6),
    workerCapacity: 2,
    storageCapacity: 600,
    allowedRecipes: [],
    allowedProductsForSale: [],
    footprint: 3,
    description: 'Stores goods. Useful as a buffer in supply chains.',
  },
  retail: {
    id: 'retail',
    name: 'Retail Store',
    type: 'retail',
    buildCost: dollars(2000),
    maintenanceCostPerDay: dollars(9),
    workerCapacity: 4,
    storageCapacity: 160,
    allowedRecipes: [],
    allowedProductsForSale: ['bread', 'coffee', 'tools', 'clothes', 'pastries', 'jewelry', 'meals', 'shoes', 'furniture', 'appliances', 'wine'],
    footprint: 3,
    description: 'Sells consumer products to citizens. Needs staff to operate.',
  },
  datacenter: {
    id: 'datacenter',
    name: 'Datacenter',
    type: 'datacenter',
    // Pricier than a factory: a datacenter is a capital play whose return is a
    // recurring seat bill from other firms, not goods on a shelf.
    buildCost: dollars(9000),
    maintenanceCostPerDay: dollars(30),
    // A small ops crew; not required to serve seats (capacity is 40 × level),
    // but the slots let a provider run payroll like any other employer.
    workerCapacity: 3,
    storageCapacity: 0,
    allowedRecipes: [],
    allowedProductsForSale: [],
    footprint: 4,
    description:
      'Sells compute seats to other firms (city-scale B2B). 40 seats per level; a firm with full seat coverage produces 6% faster company-wide.',
  },
  importer: {
    id: 'importer',
    name: 'Importer / Exporter',
    type: 'importer',
    buildCost: 0,
    maintenanceCostPerDay: 0,
    workerCapacity: 0,
    storageCapacity: 100000,
    allowedRecipes: ['import_grain', 'import_minerals', 'import_cotton'],
    allowedProductsForSale: [],
    footprint: 4,
    description: 'External supplier. Sells raw inputs at a premium on demand.',
  },
};

export function getFacilityDef(id: FacilityDefId): FacilityDefinition {
  const d = FACILITY_DEFS[id];
  if (!d) throw new Error(`Unknown facility definition: ${id}`);
  return d;
}

/**
 * The recipes a facility of this definition may run at a given preset — the
 * master `allowedRecipes` minus any whose output product doesn't exist here
 * (Arc C1). A facility's serialized `recipes` array is a copy of this list, so
 * gating the copy keeps every Village facility byte-identical (the C1 recipes
 * append after the classic ones, so the Village slice is unchanged in order and
 * membership) while City/Metropolis facilities gain the breadth recipes.
 */
export function facilityRecipesForPreset(def: FacilityDefinition, preset: SizePreset): RecipeId[] {
  return def.allowedRecipes.filter((rid) =>
    getRecipe(rid).outputs.every((o) => productAvailableInPreset(o.productId, preset)),
  );
}

/** Definitions the player may build (excludes home/importer). The datacenter is
 * NOT here: it is city-scale only and appended by buildableDefs() below so a
 * Village build menu never shows it. */
export const BUILDABLE_DEFS: FacilityDefinition[] = [
  FACILITY_DEFS.farm!,
  FACILITY_DEFS.apartment!,
  FACILITY_DEFS.mine!,
  FACILITY_DEFS.factory!,
  FACILITY_DEFS.warehouse!,
  FACILITY_DEFS.retail!,
];

/**
 * Buildable set for a given world scale. Village gets exactly BUILDABLE_DEFS
 * (the classic menu, untouched). City-scale worlds with the B2B services
 * channel enabled also offer the datacenter — the one facility gated on both
 * the size preset AND the services flag, mirroring the engine's gates.
 */
export function buildableDefs(config: {
  sizePreset: 'village' | 'city' | 'metropolis';
  servicesEnabled: boolean;
}): FacilityDefinition[] {
  if (config.sizePreset !== 'village' && config.servicesEnabled) {
    return [...BUILDABLE_DEFS, FACILITY_DEFS.datacenter!];
  }
  return BUILDABLE_DEFS;
}
