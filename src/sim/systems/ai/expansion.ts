/**
 * ai/expansion.ts — the operator's build/grow behaviors: open a store under
 * shortage, master coffee/luxury, build housing, level up a plant.
 *
 * ARCHETYPE SEAM (Arc D1, for D2). `maybeBuildApartment` is the LANDLORD seam:
 * today an operator builds housing as a side venture under a squeeze; the
 * landlord archetype will own real-estate development as its whole loop. It
 * deliberately STAYS in the operator loop's cadence for now — D2 lifts it into
 * its archetype module.
 *
 * The SERVICE seam has already been lifted (Arc D4): the operator's old
 * `maybeBuildDatacenter` is gone from here — provisioning now lives in
 * ai/ServiceBehavior.ts, owned by the 'service' archetype, generalized across the
 * service catalog (datacenter compute + office consulting).
 */

import type { SimContext, GameState } from '../../core/GameState';
import type { Firm } from '../../entities/Firm';
import { emitEvent, recordTransaction, addContract } from '../../core/GameState';
import { townOf } from '../../core/Town';
import { commercialLeaseAsk, landlordCanFinance } from './LandlordBehavior';
import { firmAccount, WORLD_ACCOUNT } from '../../core/Transactions';
import { nextId } from '../../core/Id';
import { getProduct } from '../../data/products';
import { getRecipe } from '../../data/recipes';
import { getFacilityDef } from '../../data/facilityDefinitions';
import { createFacility } from '../../entities/factories';
import type { Contract } from '../../entities/Contract';
import { hireCitizen, findUnemployed } from '../LaborSystem';
import { clamp } from '../../../utils/clamp';
import { MAX_RETAIL_PRODUCTS } from '../../data/constants';
import { landCostMultiplier, landValueAt } from '../../core/LandValue';
import { MAX_FACILITY_LEVEL, upgradeCost, upgradeFacility } from '../../core/Upgrades';
import { getPersonality, ceoQuote } from '../../data/personalities';

/**
 * The landlord (if any) that would finance a `cost` premises for `firmId` to
 * lease (Arc D2 / HD4 item 2). Picks the first — in sorted id order, for
 * determinism — solvent AI landlord with the runway to front the capital
 * (`landlordCanFinance`). Returns null when no landlord offers, which is ALWAYS
 * the case in a pinned run: the real-estate channel gates landlords entirely
 * (none are founded or seeded flag-off), so this read finds nobody and the
 * lease branch that calls it is inert. A pure sorted read — draws no rng.
 */
function findLandlordLessor(state: GameState, firmId: string, cost: number): Firm | null {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const town = townOf(state);
  for (const id of Object.keys(town.firms).sort()) {
    if (id === firmId) continue;
    const f = town.firms[id]!;
    if (f.ownerType !== 'ai' || f.strategy.archetype !== 'landlord') continue;
    if (landlordCanFinance(f, cost)) return f;
  }
  return null;
}

/**
 * Expand: when a sold product has strong, sustained unmet demand and the firm is
 * healthy, open another store (taking a loan if needed) and wire it to supply.
 * Capped so the world grows but does not explode.
 */
export function maybeExpand(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  const stores = firm.facilities.filter((id) => town.facilities[id]?.type === 'retail');
  if (stores.length >= 3) return; // cap stores per firm

  // Which product does this firm sell, and is demand unmet?
  let product: string | null = null;
  let lost = 0;
  for (const id of stores) {
    const fac = town.facilities[id]!;
    if (fac.retailProductIds.length === 0) continue;
    product = fac.retailProductIds[0]!;
    lost += fac.dailyStats.lostSales;
  }
  if (!product) return;
  const stat = town.marketStats[product]!;
  if (stat.unmetDemand < 14 || lost < 6) return; // only under real shortage
  const expandChance = Math.min(1, ctx.config.aiExpandChance * getPersonality(firm.personalityId).expandChanceMult);
  if (!rng.chance(expandChance)) return; // not every eligible day

  const def = getFacilityDef('retail');
  // Location + land premium: AI pays market rates like everyone else.
  const loc = {
    x: clamp(54 + stores.length * 12 + rng.jitter(5), 8, town.mapWidth - 8),
    y: clamp(50 + rng.jitter(6), 8, town.mapHeight - 8),
  };
  const mult = landCostMultiplier(landValueAt(state, loc));
  const cost = Math.round(def.buildCost * mult);

  // Lease-vs-buy (Arc D2 / HD4 item 2). When cash is tight — below 2× the build
  // cost — and a landlord with spare financing capacity offers, LEASE the outlet
  // instead of buying it: the landlord fronts the build and carries the asset,
  // the operator keeps its runway and pays rent (CommercialRentSystem). A pure
  // sorted read, no rng, evaluated BEFORE the buy funding. INERT in every pinned
  // run: the real-estate channel gates landlords entirely, so flag-off there is
  // no lessor (findLandlordLessor returns null), the lease branch is skipped, and
  // the buy path runs byte-for-byte as it did pre-D2. The lessor's downside is
  // bounded — a tenant that goes insolvent RETURNS the premises (repossession).
  const lessor = firm.cash < 2 * cost ? findLandlordLessor(state, firmId, cost) : null;

  // Fund the BUY path: borrow if short of cash. A lease fronts nothing (the
  // landlord carries the capital), so neither the loan nor the affordability
  // gate applies to it.
  if (!lessor) {
    if (firm.cash < cost * 1.3) {
      const need = Math.round(cost * 1.3 - firm.cash);
      const limit = Math.round((firm.cash + 1) * 1.5) + 500000;
      const draw = Math.min(need, Math.max(0, limit - firm.debt));
      if (draw > 0) {
        firm.debt += draw;
        recordTransaction(state, { from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: draw, firmId, category: 'loanDraw', note: 'Expansion loan' });
      }
    }
    if (firm.cash < cost) return;
  }

  // Find the firm's factory that produces this product (supply source).
  let sourceId: string | null = null;
  for (const id of firm.facilities) {
    const fac = town.facilities[id];
    if (fac?.activeRecipeId && getRecipe(fac.activeRecipeId).outputs.some((o) => o.productId === product)) {
      sourceId = id; break;
    }
  }

  const fac = createFacility(state, 'retail', firmId, loc, { name: `${firm.name.split(' ')[0]} Outlet ${stores.length + 1}` });
  fac.retailProductIds = [product];
  fac.buildCost = cost;
  fac.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
  if (lessor) {
    // LEASE: the landlord fronts the construction capital and carries the asset;
    // the operator runs the outlet and pays the daily rent instead of the build.
    fac.landlordFirmId = lessor.id;
    fac.rentPerDay = commercialLeaseAsk(cost);
    recordTransaction(state, { from: firmAccount(lessor.id), to: WORLD_ACCOUNT, amount: cost, firmId: lessor.id, category: 'buildSpend', note: 'Financed outlet for lease' });
  } else {
    recordTransaction(state, { from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost, firmId, category: 'buildSpend', note: 'Built store' });
  }

  // Staff it.
  for (let i = 0; i < 2; i++) { const c = findUnemployed(state); if (c) hireCitizen(state, fac.id, c); }

  // Wire supply from the source factory.
  if (sourceId) {
    const id = nextId(state.idCounters, 'ctr');
    const contract: Contract = {
      id, ownerFirmId: firmId, sourceFacilityId: sourceId, destinationFacilityId: fac.id,
      productId: product, targetQuantity: 40, reorderPoint: 18, maxInventory: 80, transportCost: 0, active: true,
    };
    addContract(ctx, contract);
  }
  const how = lessor
    ? `leased a new outlet from ${town.firms[lessor.id]!.name}`
    : 'opened a new outlet';
  emitEvent(state, 'info', 'ai', `${firm.name} ${how} to meet demand for ${getProduct(product).name}.${ceoQuote(rng, firm, 'expand')}`, fac.id);
}

/**
 * Late-game luxury entry: once the town is mature (day 60+) and a firm is
 * very flush, it masters a luxury craft matched to its supply base (grain →
 * pastries, minerals → jewelry), builds a dedicated workshop + boutique,
 * wires supply (own producer or the importer), and competes. One entry per
 * firm — the luxury market stops being the player's uncontested blue ocean.
 */
const LUXURY_ENTRY_DAY = 60;
const LUXURY_ENTRY_CASH = 38000_00; // reachable when business is genuinely good
const LUXURY_ENTRY_CHANCE = 0.05;
const LUXURY_RND_COST = 6000_00;

export function maybeEnterLuxury(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (ctx.time.day < LUXURY_ENTRY_DAY || firm.cash < LUXURY_ENTRY_CASH) return;
  // Already in luxury? One entry per firm.
  for (const facId of firm.facilities) {
    const pids = town.facilities[facId]?.retailProductIds ?? [];
    if (pids.some((p) => getProduct(p).needType === 'luxury')) return;
  }
  if (!rng.chance(LUXURY_ENTRY_CHANCE)) return;

  // Match the craft to the firm's supply base.
  let hasGrainFarm = false;
  let hasMine = false;
  let producerId: string | null = null;
  for (const facId of firm.facilities) {
    const fac = town.facilities[facId];
    if (!fac) continue;
    if (fac.activeRecipeId === 'grow_grain') { hasGrainFarm = true; producerId = producerId ?? fac.id; }
    if (fac.type === 'mine') { hasMine = true; producerId = hasGrainFarm ? producerId : fac.id; }
  }
  const luxury = hasMine && !hasGrainFarm ? 'jewelry' : 'pastries';
  const input = luxury === 'jewelry' ? 'minerals' : 'grain';
  const recipe = luxury === 'jewelry' ? 'craft_jewelry' : 'bake_pastries';

  // Costs: R&D to mastery + workshop + boutique (land-adjusted).
  const wsLoc = { x: clamp(70 + rng.jitter(10), 8, town.mapWidth - 8), y: clamp(30 + rng.jitter(4), 8, town.mapHeight - 8) };
  const shopLoc = { x: clamp(60 + rng.jitter(12), 8, town.mapWidth - 8), y: clamp(49 + rng.jitter(5), 8, town.mapHeight - 8) };
  const wsCost = Math.round(getFacilityDef('factory').buildCost * landCostMultiplier(landValueAt(state, wsLoc)));
  const shopCost = Math.round(getFacilityDef('retail').buildCost * landCostMultiplier(landValueAt(state, shopLoc)));
  const total = LUXURY_RND_COST + wsCost + shopCost;
  if (firm.cash - total < 18000_00) return;

  recordTransaction(state, {
    from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: LUXURY_RND_COST,
    firmId, category: 'rnd', productId: luxury, note: 'Luxury craft mastery program',
  });
  firm.qualityByProduct[luxury] = Math.max(firm.qualityByProduct[luxury] ?? 0, 76);
  firm.pricesByProduct[luxury] = getProduct(luxury).basePrice;
  firm.adBudgetByProduct[luxury] = 10_00;

  const workshop = createFacility(state, 'factory', firmId, wsLoc, { name: `${firm.name.split(' ')[0]} Atelier` });
  workshop.activeRecipeId = recipe;
  workshop.buildCost = wsCost;
  recordTransaction(state, { from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: wsCost, firmId, category: 'buildSpend', note: 'Built atelier' });

  const boutique = createFacility(state, 'retail', firmId, shopLoc, { name: `${firm.name.split(' ')[0]} Luxury Boutique` });
  boutique.retailProductIds = [luxury];
  boutique.buildCost = shopCost;
  recordTransaction(state, { from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: shopCost, firmId, category: 'buildSpend', note: 'Built boutique' });

  for (let i = 0; i < 2; i++) { const c = findUnemployed(state); if (c) hireCitizen(state, workshop.id, c); }
  { const c = findUnemployed(state); if (c) hireCitizen(state, boutique.id, c); }

  // Wire input supply: own producer if compatible, otherwise the importer.
  let sourceId = producerId;
  if (!sourceId || (luxury === 'jewelry' && !hasMine) || (luxury === 'pastries' && !hasGrainFarm)) {
    sourceId = Object.values(town.facilities).find((f) => f.type === 'importer')?.id ?? null;
  }
  const wire = (src: string, dest: string, pid: string, t: number, r: number, m: number): void => {
    const id = nextId(state.idCounters, 'ctr');
    const contract: Contract = {
      id, ownerFirmId: firmId, sourceFacilityId: src, destinationFacilityId: dest,
      productId: pid, targetQuantity: t, reorderPoint: r, maxInventory: m,
      transportCost: 0, active: true,
    };
    addContract(ctx, contract);
  };
  if (sourceId) wire(sourceId, workshop.id, input, 24, 10, 50);
  wire(workshop.id, boutique.id, luxury, 20, 8, 45);

  emitEvent(state, 'warning', 'ai',
    `💎 ${firm.name} enters the luxury market: ${getProduct(luxury).name} at ${boutique.name}!${ceoQuote(rng, firm, 'luxury')}`, boutique.id);
}

/**
 * Mid-game coffee entry: coffee ships as a market nobody serves — a fat
 * mainstream niche. Once a firm is comfortable it may build a roastery,
 * wire grain (own farm or the importer), and add coffee to an existing
 * store's assortment. Cheaper and earlier than luxury entry, so the
 * player's uncontested morning rush has a clock on it.
 */
const COFFEE_ENTRY_DAY = 45;
const COFFEE_ENTRY_CASH = 30000_00;
const COFFEE_ENTRY_CHANCE = 0.06;

export function maybeEnterCoffee(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (ctx.time.day < COFFEE_ENTRY_DAY || firm.cash < COFFEE_ENTRY_CASH) return;
  // One entry per firm. Multiple entrants are fine — coffee on several
  // staple shelves rides existing shopping trips via baskets (measured
  // healthier than a single scarce seller that pulls dedicated trips).
  for (const facId of firm.facilities) {
    if (town.facilities[facId]?.retailProductIds.includes('coffee')) return;
  }
  // A store with a free assortment slot is required.
  let store: import('../../entities/Facility').Facility | null = null;
  for (const facId of firm.facilities) {
    const fac = town.facilities[facId];
    if (fac?.type === 'retail' && fac.status !== 'closed' && fac.retailProductIds.length < MAX_RETAIL_PRODUCTS) {
      store = fac;
      break;
    }
  }
  if (!store) return;
  if (!rng.chance(COFFEE_ENTRY_CHANCE)) return;

  const loc = {
    x: clamp(52 + rng.jitter(10), 8, town.mapWidth - 8),
    y: clamp(33 + rng.jitter(4), 8, town.mapHeight - 8),
  };
  const cost = Math.round(getFacilityDef('factory').buildCost * landCostMultiplier(landValueAt(state, loc)));
  if (firm.cash - cost < 15000_00) return;

  const roastery = createFacility(state, 'factory', firmId, loc, { name: `${firm.name.split(' ')[0]} Roastery` });
  roastery.activeRecipeId = 'roast_coffee';
  roastery.buildCost = cost;
  recordTransaction(state, { from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost, firmId, category: 'buildSpend', note: 'Built roastery' });
  for (let i = 0; i < 2; i++) { const c = findUnemployed(state); if (c) hireCitizen(state, roastery.id, c); }

  // Grain comes from the importer, never the local farms: measured on seed 5,
  // roasteries siphoning farm grain cut the town's bread supply ~30% and
  // crashed satisfaction to 9 — coffee must be additive, not cannibalizing.
  const grainSource = Object.values(town.facilities).find((f) => f.type === 'importer')?.id ?? null;
  const wire = (src: string, dest: string, pid: string, t: number, r: number, m: number): void => {
    const id = nextId(state.idCounters, 'ctr');
    const contract: Contract = {
      id, ownerFirmId: firmId, sourceFacilityId: src, destinationFacilityId: dest,
      productId: pid, targetQuantity: t, reorderPoint: r, maxInventory: m,
      transportCost: 0, active: true,
    };
    addContract(ctx, contract);
  };
  if (grainSource) wire(grainSource, roastery.id, 'grain', 24, 10, 50);
  wire(roastery.id, store.id, 'coffee', 30, 12, 60);

  store.retailProductIds.push('coffee');
  firm.pricesByProduct['coffee'] = getProduct('coffee').basePrice;
  firm.adBudgetByProduct['coffee'] = 8_00;
  firm.qualityByProduct['coffee'] = getProduct('coffee').defaultQuality;

  emitEvent(state, 'warning', 'ai',
    `☕ ${firm.name} opens a roastery — coffee is now on the shelves at ${store.name}.${ceoQuote(rng, firm, 'expand')}`, store.id);
}

/**
 * AI landlord (D2 seam): when the town has no vacant housing, a flush firm
 * builds an apartment near the residential blocks — immigration fills it,
 * RentSystem pays the owner. Keeps real estate a contested vertical, not a
 * player-only printing press, and keeps the growth flywheel spinning in AI-only
 * towns. D1 leaves it in the operator loop; D2's landlord archetype lifts real-
 * estate development into its own module.
 */
const LANDLORD_DAY = 30;
const LANDLORD_CASH = 35000_00;
const LANDLORD_CHANCE = 0.1;
const LANDLORD_MAX_APARTMENTS = 2;

export function maybeBuildApartment(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (ctx.time.day < LANDLORD_DAY || firm.cash < LANDLORD_CASH) return;

  let owned = 0;
  let homes = 0;
  let vacancies = 0;
  for (const fid in town.facilities) {
    const f = town.facilities[fid]!;
    if (f.type !== 'home') continue;
    homes += 1;
    if (f.residentIds.length < 2) vacancies += 1;
    if (f.defId === 'apartment' && f.ownerFirmId === firmId) owned += 1;
  }
  if (owned >= LANDLORD_MAX_APARTMENTS) return;
  if (vacancies > 0 || homes >= state.config.maxHomes) return; // only under a housing squeeze
  if (!rng.chance(LANDLORD_CHANCE)) return;

  const loc = {
    x: clamp(40 + rng.jitter(24), 8, town.mapWidth - 8),
    y: clamp(64 + rng.jitter(6), 8, town.mapHeight - 8),
  };
  const def = getFacilityDef('apartment');
  const cost = Math.round(def.buildCost * landCostMultiplier(landValueAt(state, loc)));
  if (firm.cash - cost < 20000_00) return;

  const apt = createFacility(state, 'apartment', firmId, loc, {
    name: `${firm.name.split(' ')[0]} Residences`,
  });
  apt.buildCost = cost;
  apt.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * landCostMultiplier(landValueAt(state, loc)));
  recordTransaction(state, {
    from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
    firmId, category: 'buildSpend', note: 'Built apartment',
  });
  emitEvent(state, 'info', 'ai',
    `🏢 ${firm.name} built ${apt.name} — new housing for a growing town.${ceoQuote(rng, firm, 'expand')}`, apt.id);
}

/** Flush AI firms level up a production facility now and then. */
export function maybeUpgrade(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (firm.cash < 45000_00 || !rng.chance(0.08)) return;
  for (const facId of firm.facilities) {
    const fac = town.facilities[facId];
    if (!fac || (fac.type !== 'farm' && fac.type !== 'mine' && fac.type !== 'factory')) continue;
    if (fac.level >= MAX_FACILITY_LEVEL) continue;
    const cost = upgradeCost(state, facId);
    if (firm.cash - cost < 30000_00) continue;
    upgradeFacility(state, firmId, facId);
    return;
  }
}
