/**
 * ChainBuilder — builds a complete single-product chain (producer → factory →
 * store) for a firm: placed near the homes' center of mass, built at land
 * prices (paid to the world), staffed from the unemployed pool, wired with
 * supply contracts, and priced at base. Shared by the player's chain wizard
 * (BUILD_CHAIN) and the AI founder system, so a founded rival is built by
 * exactly the machinery the player uses.
 */

import type { GameState } from './GameState';
import { recordTransaction } from './GameState';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import { nextId } from './Id';
import type { FirmId } from './Id';
import type { Facility } from '../entities/Facility';
import { createFacility } from '../entities/factories';
import { getFacilityDef } from '../data/facilityDefinitions';
import { getRecipe } from '../data/recipes';
import { getProduct } from '../data/products';
import { CHAIN_BLUEPRINTS, stageOutput } from '../data/chains';
import { landCostMultiplier, landValueAt } from './LandValue';
import { firstFreeDistrictSlot, type SlotSpec } from './DistrictSlots';
import { findUnemployed, hireCitizen } from '../systems/LaborSystem';
import { townOf } from './Town';

export interface BuiltChain {
  /** Production-stage facilities in order (stage[0] = the raw producer, the
   * last = the factory that makes the consumer good). Length matches the
   * blueprint's `stages`: 2 for a classic chain, 3 for a deep C3 chain. */
  stages: Facility[];
  store: Facility;
  /** Back-compat conveniences: the first stage (raw producer) and the last
   * production stage (the factory that makes the retailed good). */
  producer: Facility;
  factory: Facility;
}

/** Slot grids for City/Metropolis chain placement: producers/factories tile
 * the industrial belt, stores tile the commercial core. Producers pack tight
 * (proximity to a store is irrelevant — they ship by contract). Stores use a
 * WIDE x-step so row-major enumeration spreads them across the full commercial
 * width before wrapping to a second row, instead of clustering at the west edge
 * — every residential district then has a store within shopping reach on the
 * far side of the map, which is the whole point of the district partition. */
const INDUSTRIAL_SLOT_SPEC: SlotSpec = { stepX: 8, stepY: 8, margin: 6, clearRadius: 6 };
const COMMERCIAL_SLOT_SPEC: SlotSpec = { stepX: 28, stepY: 12, margin: 8, clearRadius: 6 };

/**
 * Build the full chain, paying land-priced build costs from the firm to the
 * world. Returns null (building nothing) when the map has no clear ground.
 * Affordability is the CALLER's contract — check before calling.
 */
export function buildStarterChain(
  state: GameState,
  firmId: FirmId,
  productId: string,
): BuiltChain | null {
  const s = state;
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const firm = townOf(s).firms[firmId];
  const bp = CHAIN_BLUEPRINTS[productId];
  if (!firm || !bp) return null;

  // Prefer clear ground nearest the homes' center of mass — a store on the
  // town edge never sees foot traffic, whatever it costs.
  let homeCx = s.config.mapWidth / 2;
  let homeCount = 0;
  for (const fid in s.facilities) {
    const f = s.facilities[fid]!;
    if (f.type === 'home') { homeCx += f.location.x; homeCount++; }
  }
  if (homeCount > 0) homeCx = (homeCx - s.config.mapWidth / 2) / homeCount;
  const findSpot = (y: number): { x: number; y: number } | null => {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (let x = 12; x <= s.config.mapWidth - 8; x += 6) {
      let clear = true;
      for (const fid in s.facilities) {
        const loc = s.facilities[fid]!.location;
        const dx = loc.x - x;
        const dy = loc.y - y;
        if (dx * dx + dy * dy < 36) {
          clear = false;
          break;
        }
      }
      if (clear && Math.abs(x - homeCx) < bestDist) {
        bestDist = Math.abs(x - homeCx);
        best = { x, y };
      }
    }
    return best;
  };
  // Village keeps the three fixed build rows EXACTLY (bit-identity contract —
  // the founder tests and 300-day baseline pin these coordinates). Village
  // chains are always 2-stage (the deep C3 chains are metropolis-only), so the
  // three rows map to [stage0, stage1, store]. City/Metropolis enumerate free
  // slots by district: every production stage into the industrial belt, the
  // store into the commercial core (A4). Slots resolve sequentially (reserving
  // the ones already taken) so no two stages land on the same spot — a 2-stage
  // chain resolves IDENTICALLY to the pre-C3 producer/factory/store scan.
  const nStages = bp.stages.length;
  let spots: ({ x: number; y: number } | null)[];
  if (s.config.sizePreset === 'village') {
    // Village never builds a deep chain; the fixed rows cover producer+factory.
    // Guard the invariant: a future Village-gated 3-stage blueprint would index
    // past this array and throw at the store build with a useless error — fail
    // loudly at the source instead.
    if (nStages > 2) {
      throw new Error(
        `Village chain '${bp.productId}' has ${nStages} stages; the fixed Village rows support 2 (deep chains are metropolis-only)`,
      );
    }
    spots = [findSpot(20), findSpot(33), findSpot(51)];
  } else {
    const reserved: { x: number; y: number }[] = [];
    const stageSpots: ({ x: number; y: number } | null)[] = [];
    for (let i = 0; i < nStages; i++) {
      const slot = firstFreeDistrictSlot(s, 'industrial', INDUSTRIAL_SLOT_SPEC, reserved);
      stageSpots.push(slot);
      if (slot) reserved.push(slot);
    }
    const store = firstFreeDistrictSlot(s, 'commercial', COMMERCIAL_SLOT_SPEC);
    spots = [...stageSpots, store];
  }
  if (spots.some((p) => p === null)) return null;

  const build = (defId: string, loc: { x: number; y: number }): Facility => {
    const def = getFacilityDef(defId);
    const mult = landCostMultiplier(landValueAt(s, loc));
    const price = Math.round(def.buildCost * mult);
    const fac = createFacility(s, defId, firmId, loc);
    fac.buildCost = price;
    fac.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
    if (price > 0) {
      recordTransaction(s, {
        from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: price,
        firmId, category: 'buildSpend', note: `Built ${def.name}`,
      });
    }
    return fac;
  };
  // Build every production stage in order, then the store — same facility
  // creation order (hence id order) the pre-C3 producer/factory/store did.
  const stageFacilities: Facility[] = [];
  for (let i = 0; i < nStages; i++) {
    const stage = bp.stages[i]!;
    const fac = build(stage.facilityDefId, spots[i]!);
    fac.activeRecipeId = stage.recipeId;
    stageFacilities.push(fac);
  }
  const store = build('retail', spots[nStages]!);
  store.retailProductIds = [bp.productId];
  if (!firm.pricesByProduct[bp.productId]) {
    firm.pricesByProduct[bp.productId] = getProduct(bp.productId).basePrice;
  }

  const staff = (facilityId: string, count: number): void => {
    for (let i = 0; i < count; i++) {
      const cid = findUnemployed(s);
      if (!cid || !hireCitizen(s, facilityId, cid)) break;
    }
  };
  // Staff every stage (by its recipe's labor), then the store — same order as
  // the pre-C3 producer/factory/store staffing (so 2-stage hires are identical).
  for (let i = 0; i < nStages; i++) {
    staff(stageFacilities[i]!.id, getRecipe(bp.stages[i]!.recipeId).laborRequired);
  }
  staff(store.id, 1);

  const wire = (sourceId: string, destId: string, pid: string): void => {
    const id = nextId(s.idCounters, 'ctr');
    s.contracts[id] = {
      id, ownerFirmId: firmId, sourceFacilityId: sourceId,
      destinationFacilityId: destId, productId: pid,
      targetQuantity: 40, reorderPoint: 16, maxInventory: 80,
      transportCost: 0, active: true,
    };
  };
  // Wire each stage to the next (shipping that stage's output), then the last
  // stage to the store (shipping the consumer good). For a 2-stage chain this
  // is exactly wire(producer→factory, rawInput) then wire(factory→store, good).
  for (let i = 0; i < nStages - 1; i++) {
    wire(stageFacilities[i]!.id, stageFacilities[i + 1]!.id, stageOutput(bp.stages[i]!));
  }
  wire(stageFacilities[nStages - 1]!.id, store.id, bp.productId);

  return {
    stages: stageFacilities,
    store,
    producer: stageFacilities[0]!,
    factory: stageFacilities[nStages - 1]!,
  };
}
