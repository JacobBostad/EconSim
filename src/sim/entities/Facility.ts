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
  /** Portion of lostSales from shoppers arriving after closing time —
   * friction, not scarcity, so the digest can name it honestly. */
  closedDoorVisits: number;
  /** Would-be purchases abandoned because the price exceeded willingness to pay. */
  pricedOut: number;
  /**
   * Internal shipments valued at market price when they left / arrived.
   * Lets per-facility P&L credit producers for goods they made (whose cash
   * revenue is only realized downstream at retail) and debit receivers.
   */
  transferOutValue: number; // cents
  transferInValue: number; // cents
  ticksActive: number;
  /** Last binding constraint seen during work hours (null = ran clean). */
  bottleneck: string | null;
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
    closedDoorVisits: 0,
    pricedOut: 0,
    transferOutValue: 0,
    transferInValue: 0,
    ticksActive: 0,
    bottleneck: null,
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
  /** Products this store sells (retail only; up to MAX_RETAIL_PRODUCTS). */
  retailProductIds: ProductId[];
  operatingCostPerDay: number; // maintenance, cents
  buildCost: number; // cents
  productionProgress: number;
  status: FacilityStatus;
  bottleneckReason: string | null;
  dailyStats: FacilityDailyStats;
  /**
   * The last fully closed day's stats, snapshotted at the daily reset. UI and
   * advisors read this instead of the mid-day partial dailyStats.
   */
  yesterdayStats: FacilityDailyStats;
  /**
   * 7-day EMA of the facility's attributed P&L (cents/day), updated at the
   * daily snapshot. Ship-day/idle-day alternation makes single-day numbers
   * flip-flop; this is the stable signal the P&L table and advisor rank by.
   */
  pnlEma: { revenue: number; cost: number; net: number };
  /** Workers physically present and working this tick (set by LaborSystem). */
  presentWorkers: number;
  /** Sum of present workers' skill this tick (crew productivity). */
  presentSkill: number;
  /** Tick this facility was built (0 = founding-era). Drives store novelty. */
  builtAtTick: number;
  /** Upgrade level (1..3): +40% storage, +15% efficiency, +1 worker cap each. */
  level: number;
  /**
   * Standing export orders (warehouses): productId -> auto-export when Port
   * Rosa pays at least minMult × base, keeping `keep` units in reserve.
   */
  exportOrders: Record<string, { minMult: number; keep: number }>;
  /** Effective worker capacity (base def capacity + upgrades). */
  workerCapacity: number;
  /** For homes: which citizen lives here (informational). */
  residentIds: CitizenId[];
  /**
   * Whether other firms may buy this facility's surplus wholesale. Defaults
   * on; a player staging stock for an export spike can switch it off so AI
   * buyers can't force a sale at the wholesale discount.
   */
  wholesaleEnabled: boolean;
  /**
   * Seller's wholesale price as a fraction of market average (0.5–1.0).
   * Absent = the default WHOLESALE_DISCOUNT (0.7). Undercut to win AI
   * customers; price above import parity and they walk.
   */
  wholesalePriceMult?: number;
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
