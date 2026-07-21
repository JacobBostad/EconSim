/**
 * ai/expansion.ts — the operator's build/grow behaviors: open a store under
 * shortage, master coffee/luxury, build housing or compute, level up a plant.
 *
 * ARCHETYPE SEAMS (Arc D1, for D2–D4). Two of these behaviors are the physical
 * seeds of the specialist archetypes that D2/D4 will carve out:
 *  - `maybeBuildApartment` is the LANDLORD seam (D2): today an operator builds
 *    housing as a side venture under a squeeze; the landlord archetype will own
 *    real-estate development as its whole loop.
 *  - `maybeBuildDatacenter` is the SERVICE seam (D4): today an operator enters
 *    compute opportunistically; the service archetype will own provisioning.
 * They deliberately STAY in the operator loop's cadence for now (D1 is a pure
 * refactor) — D3/D4 lift them into their archetype modules, not this arc.
 */

import type { SimContext } from '../../core/GameState';
import { emitEvent, recordTransaction, addContract } from '../../core/GameState';
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
import { DATACENTER_SEATS_PER_LEVEL } from '../../data/services';

/**
 * Expand: when a sold product has strong, sustained unmet demand and the firm is
 * healthy, open another store (taking a loan if needed) and wire it to supply.
 * Capped so the world grows but does not explode.
 */
export function maybeExpand(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  const stores = firm.facilities.filter((id) => state.facilities[id]?.type === 'retail');
  if (stores.length >= 3) return; // cap stores per firm

  // Which product does this firm sell, and is demand unmet?
  let product: string | null = null;
  let lost = 0;
  for (const id of stores) {
    const fac = state.facilities[id]!;
    if (fac.retailProductIds.length === 0) continue;
    product = fac.retailProductIds[0]!;
    lost += fac.dailyStats.lostSales;
  }
  if (!product) return;
  const stat = state.marketStats[product]!;
  if (stat.unmetDemand < 14 || lost < 6) return; // only under real shortage
  const expandChance = Math.min(1, ctx.config.aiExpandChance * getPersonality(firm.personalityId).expandChanceMult);
  if (!rng.chance(expandChance)) return; // not every eligible day

  const def = getFacilityDef('retail');
  // Location + land premium: AI pays market rates like everyone else.
  const loc = {
    x: clamp(54 + stores.length * 12 + rng.jitter(5), 8, state.config.mapWidth - 8),
    y: clamp(50 + rng.jitter(6), 8, state.config.mapHeight - 8),
  };
  const mult = landCostMultiplier(landValueAt(state, loc));
  const cost = Math.round(def.buildCost * mult);
  // Fund: borrow if short of cash.
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

  // Find the firm's factory that produces this product (supply source).
  let sourceId: string | null = null;
  for (const id of firm.facilities) {
    const fac = state.facilities[id];
    if (fac?.activeRecipeId && getRecipe(fac.activeRecipeId).outputs.some((o) => o.productId === product)) {
      sourceId = id; break;
    }
  }

  const fac = createFacility(state, 'retail', firmId, loc, { name: `${firm.name.split(' ')[0]} Outlet ${stores.length + 1}` });
  fac.retailProductIds = [product];
  fac.buildCost = cost;
  fac.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
  recordTransaction(state, { from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost, firmId, category: 'buildSpend', note: 'Built store' });

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
  emitEvent(state, 'info', 'ai', `${firm.name} opened a new outlet to meet demand for ${getProduct(product).name}.${ceoQuote(rng, firm, 'expand')}`, fac.id);
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
  const firm = state.firms[firmId]!;
  if (ctx.time.day < LUXURY_ENTRY_DAY || firm.cash < LUXURY_ENTRY_CASH) return;
  // Already in luxury? One entry per firm.
  for (const facId of firm.facilities) {
    const pids = state.facilities[facId]?.retailProductIds ?? [];
    if (pids.some((p) => getProduct(p).needType === 'luxury')) return;
  }
  if (!rng.chance(LUXURY_ENTRY_CHANCE)) return;

  // Match the craft to the firm's supply base.
  let hasGrainFarm = false;
  let hasMine = false;
  let producerId: string | null = null;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac) continue;
    if (fac.activeRecipeId === 'grow_grain') { hasGrainFarm = true; producerId = producerId ?? fac.id; }
    if (fac.type === 'mine') { hasMine = true; producerId = hasGrainFarm ? producerId : fac.id; }
  }
  const luxury = hasMine && !hasGrainFarm ? 'jewelry' : 'pastries';
  const input = luxury === 'jewelry' ? 'minerals' : 'grain';
  const recipe = luxury === 'jewelry' ? 'craft_jewelry' : 'bake_pastries';

  // Costs: R&D to mastery + workshop + boutique (land-adjusted).
  const wsLoc = { x: clamp(70 + rng.jitter(10), 8, state.config.mapWidth - 8), y: clamp(30 + rng.jitter(4), 8, state.config.mapHeight - 8) };
  const shopLoc = { x: clamp(60 + rng.jitter(12), 8, state.config.mapWidth - 8), y: clamp(49 + rng.jitter(5), 8, state.config.mapHeight - 8) };
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
    sourceId = Object.values(state.facilities).find((f) => f.type === 'importer')?.id ?? null;
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
  const firm = state.firms[firmId]!;
  if (ctx.time.day < COFFEE_ENTRY_DAY || firm.cash < COFFEE_ENTRY_CASH) return;
  // One entry per firm. Multiple entrants are fine — coffee on several
  // staple shelves rides existing shopping trips via baskets (measured
  // healthier than a single scarce seller that pulls dedicated trips).
  for (const facId of firm.facilities) {
    if (state.facilities[facId]?.retailProductIds.includes('coffee')) return;
  }
  // A store with a free assortment slot is required.
  let store: import('../../entities/Facility').Facility | null = null;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (fac?.type === 'retail' && fac.status !== 'closed' && fac.retailProductIds.length < MAX_RETAIL_PRODUCTS) {
      store = fac;
      break;
    }
  }
  if (!store) return;
  if (!rng.chance(COFFEE_ENTRY_CHANCE)) return;

  const loc = {
    x: clamp(52 + rng.jitter(10), 8, state.config.mapWidth - 8),
    y: clamp(33 + rng.jitter(4), 8, state.config.mapHeight - 8),
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
  const grainSource = Object.values(state.facilities).find((f) => f.type === 'importer')?.id ?? null;
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
  const firm = state.firms[firmId]!;
  if (ctx.time.day < LANDLORD_DAY || firm.cash < LANDLORD_CASH) return;

  let owned = 0;
  let homes = 0;
  let vacancies = 0;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.type !== 'home') continue;
    homes += 1;
    if (f.residentIds.length < 2) vacancies += 1;
    if (f.defId === 'apartment' && f.ownerFirmId === firmId) owned += 1;
  }
  if (owned >= LANDLORD_MAX_APARTMENTS) return;
  if (vacancies > 0 || homes >= state.config.maxHomes) return; // only under a housing squeeze
  if (!rng.chance(LANDLORD_CHANCE)) return;

  const loc = {
    x: clamp(40 + rng.jitter(24), 8, state.config.mapWidth - 8),
    y: clamp(64 + rng.jitter(6), 8, state.config.mapHeight - 8),
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

/**
 * AI compute provider (HD3; D4 seam): a very flush firm builds a datacenter to
 * enter the B2B compute market when demand is tight — total seats sold across
 * the town is running near capacity, so a new provider can win subscribers.
 * Deterministic (no rng draws): the gates are cash/utilization conditions, so
 * this never perturbs the shared stream, and it is doubly gated on the services
 * flag + non-Village scale (both false in every pinned baseline). Capped so the
 * town grows a compute market rather than exploding into datacenters. D1 leaves
 * it in the operator loop; D4's service archetype lifts provisioning out.
 */
const DATACENTER_ENTRY_DAY = 40;
const DATACENTER_ENTRY_CASH = 120000_00;
const DATACENTER_KEEP_BUFFER = 60000_00;
const DATACENTER_MAX_PROVIDERS = 4;
const DATACENTER_TIGHT_UTIL = 0.9;

export function maybeBuildDatacenter(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  if (!ctx.config.servicesEnabled || ctx.config.sizePreset === 'village') return;
  const firm = state.firms[firmId]!;
  if (ctx.time.day < DATACENTER_ENTRY_DAY || firm.cash < DATACENTER_ENTRY_CASH) return;

  // Already a provider, or the market already has enough providers? Also read
  // town-wide compute utilization to decide whether a new entrant is warranted.
  let providers = 0;
  let capacity = 0;
  for (const fid in state.firms) {
    let firmCap = 0;
    for (const facId of state.firms[fid]!.facilities) {
      const fac = state.facilities[facId];
      if (fac?.type === 'datacenter' && fac.status !== 'closed') firmCap += DATACENTER_SEATS_PER_LEVEL * fac.level;
    }
    if (firmCap > 0) {
      providers += 1;
      capacity += firmCap;
      if (fid === firmId) return; // this firm is already a provider
    }
  }
  if (providers >= DATACENTER_MAX_PROVIDERS) return;
  let sold = 0;
  for (const cid in state.serviceContracts) sold += state.serviceContracts[cid]!.seats;
  const util = capacity > 0 ? sold / capacity : 1; // no capacity yet ⇒ treat as tight
  if (util < DATACENTER_TIGHT_UTIL) return;

  const def = getFacilityDef('datacenter');
  const loc = {
    x: clamp(48 + providers * 14, 8, state.config.mapWidth - 8),
    y: clamp(38, 8, state.config.mapHeight - 8),
  };
  const cost = Math.round(def.buildCost * landCostMultiplier(landValueAt(state, loc)));
  if (firm.cash - cost < DATACENTER_KEEP_BUFFER) return;

  const dc = createFacility(state, 'datacenter', firmId, loc, {
    name: `${firm.name.split(' ')[0]} Compute`,
  });
  dc.buildCost = cost;
  dc.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * landCostMultiplier(landValueAt(state, loc)));
  recordTransaction(state, {
    from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
    firmId, category: 'buildSpend', note: 'Built datacenter',
  });
  emitEvent(state, 'info', 'ai',
    `🖥️ ${firm.name} opened ${dc.name} — a new compute provider for the city's firms.`, dc.id);
}

/** Flush AI firms level up a production facility now and then. */
export function maybeUpgrade(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.cash < 45000_00 || !rng.chance(0.08)) return;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || (fac.type !== 'farm' && fac.type !== 'mine' && fac.type !== 'factory')) continue;
    if (fac.level >= MAX_FACILITY_LEVEL) continue;
    const cost = upgradeCost(state, facId);
    if (firm.cash - cost < 30000_00) continue;
    upgradeFacility(state, firmId, facId);
    return;
  }
}
