/**
 * Facility.ts — Facility entity + facility definition types.
 *
 * A Facility is a placed building owned by a firm (homes are owned by the
 * "world"/municipality). It holds input and output inventories, runs a recipe
 * (production facilities) or sells products (retail facilities), and employs
 * citizens. FacilityDefinition is the static, data-driven template.
 */

import type {
  FacilityId,
  FirmId,
  CitizenId,
  RecipeId,
  ProductId,
  FacilityDefId,
} from '../core/Id';
import type { Vec2 } from './Location';
import type { Inventory } from './Inventory';

export type FacilityType =
  | 'home'
  | 'farm'
  | 'mine'
  | 'factory'
  | 'warehouse'
  | 'retail'
  | 'importer';

export type FacilityStatus =
  | 'active'
  | 'idle'
  | 'input-starved'
  | 'labor-starved'
  | 'inventory-full'
  | 'closed';

export interface FacilityDailyStats {
  unitsProduced: number;
  unitsSold: number;
  unitsReceived: number;
  unitsShipped: number;
  revenue: number; // cents
  variableCost: number; // cents
  lostSales: number; // demand attempts that failed due to stockout
  ticksActive: number;
}

export function emptyFacilityDailyStats(): FacilityDailyStats {
  return {
    unitsProduced: 0,
    unitsSold: 0,
    unitsReceived: 0,
    unitsShipped: 0,
    revenue: 0,
    variableCost: 0,
    lostSales: 0,
    ticksActive: 0,
  };
}

export interface Facility {
  id: FacilityId;
  defId: FacilityDefId;
  name: string;
  type: FacilityType;
  /** Owning firm. Homes are owned by the world firm. */
  ownerFirmId: FirmId;
  location: Vec2;
  employees: CitizenId[];
  inputInventory: Inventory;
  outputInventory: Inventory;
  /** Combined storage capacity (units) across input + output. */
  storageCapacity: number;
  /** Recipes this facility is allowed to run. */
  recipes: RecipeId[];
  activeRecipeId: RecipeId | null;
  /** For retail facilities: the single product currently offered for sale. */
  retailProductId: ProductId | null;
  operatingCostPerDay: number; // maintenance, cents
  buildCost: number; // cents
  productionProgress: number;
  status: FacilityStatus;
  bottleneckReason: string | null;
  dailyStats: FacilityDailyStats;
  /** Workers physically present and working this tick (set by LaborSystem). */
  presentWorkers: number;
  /** Sum of present workers' skill this tick (crew productivity). */
  presentSkill: number;
  /** Upgrade level (1..3): +40% storage, +15% efficiency, +1 worker cap each. */
  level: number;
  /** Effective worker capacity (base def capacity + upgrades). */
  workerCapacity: number;
  /** For homes: which citizen lives here (informational). */
  residentIds: CitizenId[];
}

/** Static template for a buildable facility. */
export interface FacilityDefinition {
  id: FacilityDefId;
  name: string;
  type: FacilityType;
  buildCost: number; // cents
  maintenanceCostPerDay: number; // cents
  workerCapacity: number;
  storageCapacity: number;
  allowedRecipes: RecipeId[];
  allowedProductsForSale: ProductId[];
  footprint: number;
  description: string;
}
