/**
 * facilityDefinitions.ts — Buildable facility templates (data-driven).
 *
 * The BuildPanel reads `BUILDABLE_DEFS` for what the player can construct. To
 * add a new building type, append a FacilityDefinition and (if it produces)
 * reference recipes from recipes.ts.
 */

import type { FacilityDefinition } from '../entities/Facility';
import type { FacilityDefId } from '../core/Id';
import { dollars } from './constants';

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
    allowedRecipes: ['grow_grain', 'grow_cotton'],
    allowedProductsForSale: [],
    footprint: 4,
    description: 'Grows grain or cotton. Needs workers; no inputs required.',
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
    allowedRecipes: ['bake_bread', 'roast_coffee', 'make_tools', 'sew_clothes', 'bake_pastries', 'craft_jewelry'],
    allowedProductsForSale: [],
    footprint: 4,
    description:
      'Manufactures goods from inputs: bread, tools, clothes — or luxury pastries and jewelry once your craft quality reaches 75.',
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
    allowedProductsForSale: ['bread', 'coffee', 'tools', 'clothes', 'pastries', 'jewelry'],
    footprint: 3,
    description: 'Sells one consumer product to citizens. Needs staff to operate.',
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

/** Definitions the player may build (excludes home/importer). */
export const BUILDABLE_DEFS: FacilityDefinition[] = [
  FACILITY_DEFS.farm!,
  FACILITY_DEFS.apartment!,
  FACILITY_DEFS.mine!,
  FACILITY_DEFS.factory!,
  FACILITY_DEFS.warehouse!,
  FACILITY_DEFS.retail!,
];
