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
import { CHAIN_BLUEPRINTS } from '../data/chains';
import { landCostMultiplier, landValueAt } from './LandValue';
import { findUnemployed, hireCitizen } from '../systems/LaborSystem';

export interface BuiltChain {
  producer: Facility;
  factory: Facility;
  store: Facility;
}

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
  const firm = s.firms[firmId];
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
  const spots = [findSpot(20), findSpot(33), findSpot(51)];
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
  const producer = build(bp.producerDefId, spots[0]!);
  const factory = build('factory', spots[1]!);
  const store = build('retail', spots[2]!);

  producer.activeRecipeId = bp.producerRecipeId;
  factory.activeRecipeId = bp.factoryRecipeId;
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
  staff(producer.id, getRecipe(bp.producerRecipeId).laborRequired);
  staff(factory.id, getRecipe(bp.factoryRecipeId).laborRequired);
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
  wire(producer.id, factory.id, bp.inputProductId);
  wire(factory.id, store.id, bp.productId);

  return { producer, factory, store };
}
