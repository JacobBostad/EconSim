/**
 * AIStrategySystem — runs once per day for each AI firm.
 *
 * Behaviour (kept simple but economically real):
 *  - Re-staff facilities whose workers quit, when the firm is healthy and can
 *    afford it, so AI supply chains keep running.
 *  - Adjust each sold product's price: raise 2–5% after sellouts/lost sales,
 *    lower 2–5% when inventory is glutted, within [floor, ceil] × base price.
 *  - If the firm has been losing money, nudge prices up to defend margin.
 *
 * The AI reads the just-completed day's facility stats and the firm's `today`
 * accounting (both still intact at this point in the tick order).
 */

import type { SimContext } from '../core/GameState';
import { formatMoney } from '../../utils/formatMoney';
import { emitEvent, canAfford, recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { nextId } from '../core/Id';
import { isDayBoundary } from '../core/Tick';
import { operatingProfit } from '../entities/Accounting';
import { getProduct } from '../data/products';
import { getRecipe } from '../data/recipes';
import { getQuantity, removeStock } from '../entities/Inventory';
import { getFacilityDef } from '../data/facilityDefinitions';
import { createFacility } from '../entities/factories';
import type { Contract } from '../entities/Contract';
import { hireCitizen, fireCitizen, findUnemployed } from './LaborSystem';
import { clamp } from '../../utils/clamp';
import { CENTS, RND_QUALITY_GAIN_PER_1000, MAX_RETAIL_PRODUCTS, IMPORT_MARKUP, WHOLESALE_DISCOUNT } from '../data/constants';
import { wholesaleUnitPrice, localSurplus } from '../core/Wholesale';
import { worldImportMult } from '../data/worldEvents';
import { companyValuation } from '../selectors/companySelectors';
import { acquisitionCost, performAcquisition } from '../core/Acquisition';
import { landCostMultiplier, landValueAt } from '../core/LandValue';
import { MAX_FACILITY_LEVEL, upgradeCost, upgradeFacility } from '../core/Upgrades';
import { getPersonality, ceoQuote } from '../data/personalities';
import { pickBestCity } from '../core/Trade';
import { getTradeCity } from '../data/tradeCities';

export function runAIStrategySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    if (firm.bankruptcyStatus !== 'insolvent') {
      manageWages(ctx, firm.id);
      restaff(ctx, firm.id);
      maybeBoostProduction(ctx, firm.id);
      maybeWidenShelves(ctx, firm.id);
    }
    adjustPrices(ctx, firm.id);
    if (firm.bankruptcyStatus === 'healthy') {
      manageDebt(ctx, firm.id);
      manageSourcing(ctx, firm.id);
      manageWholesalePricing(ctx, firm.id);
      manageAdBudget(ctx, firm.id);
      maybeInvestQuality(ctx, firm.id);
      maybeExpand(ctx, firm.id);
      maybeBuyShares(ctx, firm.id);
      maybeExportSurplus(ctx, firm.id);
      maybeUpgrade(ctx, firm.id);
      maybeBuildApartment(ctx, firm.id);
      maybeEnterCoffee(ctx, firm.id);
      maybeEnterLuxury(ctx, firm.id);
      if (maybeRescueAcquisition(ctx, firm.id)) continue; // firm map changed
    }

    // Track loss streak.
    const op = operatingProfit(firm.accounting.today);
    firm.strategy.lossStreak = op < 0 ? firm.strategy.lossStreak + 1 : 0;
  }

  // Player QoL: auto-priced products are "managed" — the same mean-reverting
  // price controller sets their prices, the same shelf-widening keeps their
  // supply contracts sized to demand, and ad spend drifts down toward the
  // floor while the store loses money (downward only — raising the player's
  // spend is the player's call). Deterministic; no rng-stream impact.
  const player = state.firms[state.playerFirmId];
  if (player && Object.values(player.autoPriceByProduct).some(Boolean)) {
    adjustPrices(ctx, player.id, true);
    maybeWidenShelves(ctx, player.id, true);
    trimManagedAds(ctx, player.id);
  }
}

/**
 * Ad-budget counterplay: fight for attention when losing the market, save
 * money when dominant or bleeding cash. Budgets move in small daily steps so
 * the arms race reads as a campaign, not a switch.
 */
const AD_BUDGET_CAP = 40_00; // $40/day
const AD_BUDGET_STEP = 4_00;
const AD_BUDGET_FLOOR = 8_00;

function manageAdBudget(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  const persona = getPersonality(firm.personalityId);
  const cap = Math.round(AD_BUDGET_CAP * persona.adMult);
  const step = Math.round(AD_BUDGET_STEP * persona.adMult);
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail') continue;
    for (const pid of fac.retailProductIds) {
    const share = firm.marketShareByProduct[pid] ?? 0;
    const budget = firm.adBudgetByProduct[pid] ?? 0;
    if (firm.strategy.lossStreak >= 3 || share > 0.7) {
      // Bleeding or dominant: dial spend down toward the floor.
      if (budget > AD_BUDGET_FLOOR) {
        firm.adBudgetByProduct[pid] = Math.max(AD_BUDGET_FLOOR, budget - step / 2);
      }
    } else if (share < 0.5 && firm.cash > 15000_00 && budget < cap) {
      firm.adBudgetByProduct[pid] = Math.min(cap, budget + step);
      if (budget + step >= cap) {
        emitEvent(state, 'info', 'ai',
          `${firm.name} is running a maximum ad campaign for ${getProduct(pid).name}.${ceoQuote(rng, firm, 'ads')}`, firm.id);
      }
    }
    }
  }
}

/**
 * Ad discipline for the player's managed products: while the selling store's
 * 7-day P&L is negative, the ad budget steps down toward the AI's floor. The
 * wizard's starter budget (25% of a young chain's revenue) otherwise burns
 * forever on a business that can't afford it yet.
 */
function trimManagedAds(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail' || fac.pnlEma.net >= 0) continue;
    for (const pid of fac.retailProductIds) {
      if (!firm.autoPriceByProduct[pid]) continue;
      const budget = firm.adBudgetByProduct[pid] ?? 0;
      if (budget > AD_BUDGET_FLOOR) {
        firm.adBudgetByProduct[pid] = Math.max(AD_BUDGET_FLOOR, budget - AD_BUDGET_STEP / 2);
      }
    }
  }
}

/** Best quality any OTHER firm has for a product (the bar to beat). */
function bestRivalQuality(ctx: SimContext, firmId: string, pid: string): number {
  let best = 0;
  for (const fid in ctx.state.firms) {
    if (fid === firmId) continue;
    best = Math.max(best, ctx.state.firms[fid]!.qualityByProduct[pid] ?? 0);
  }
  return best;
}

/**
 * Invest in product quality when flush — and always respond when a rival
 * (usually the player) out-qualities them, up to a higher ceiling.
 */
function maybeInvestQuality(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.cash < 25000_00 /* $25k buffer */) return;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail') continue;
    const pid = fac.retailProductIds[0];
    if (!pid) continue;
    const cur = firm.qualityByProduct[pid] ?? getProduct(pid).defaultQuality;
    const behindRival = bestRivalQuality(ctx, firmId, pid) > cur + 5;
    if (!behindRival && !rng.chance(getPersonality(firm.personalityId).rndChance)) return;
    if (cur >= (behindRival ? 88 : 80)) continue;
    const amount = 1200_00; // $1,200 R&D
    if (!canAfford(state, firmAccount(firmId), amount + 20000_00)) continue;
    recordTransaction(state, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount,
      firmId, category: 'rnd', productId: pid, note: 'AI R&D',
    });
    const headroom = (100 - cur) / 100;
    firm.qualityByProduct[pid] = Math.min(100, cur + RND_QUALITY_GAIN_PER_1000 * (amount / (1000 * CENTS)) * headroom);
    return; // one investment per day
  }
}

/**
 * Expand: when a sold product has strong, sustained unmet demand and the firm is
 * healthy, open another store (taking a loan if needed) and wire it to supply.
 * Capped so the world grows but does not explode.
 */
function maybeExpand(ctx: SimContext, firmId: string): void {
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
    state.contracts[id] = contract;
  }
  emitEvent(state, 'info', 'ai', `${firm.name} opened a new outlet to meet demand for ${getProduct(product).name}.${ceoQuote(rng, firm, 'expand')}`, fac.id);
}

/**
 * When very flush, AI firms park spare cash in rival equity (including the
 * player's!) for dividend income — 5% at a time, capped at a 25% stake, and
 * never spending below a healthy cash buffer. Mirrors the pricing used by the
 * player's BUY_SHARES command so the market feels consistent.
 */
const AI_SHARE_CASH_FLOOR = 35000_00; // keep at least $35k after buying
const AI_MAX_STAKE = 25;

function maybeBuyShares(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.cash < AI_SHARE_CASH_FLOOR || !rng.chance(0.12)) return;

  // Target the most valuable other company still below our stake cap.
  let target: string | null = null;
  let targetVal = 0;
  for (const fid in state.firms) {
    if (fid === firmId) continue;
    const other = state.firms[fid]!;
    if (other.ownerType !== 'player' && other.ownerType !== 'ai') continue;
    if ((firm.sharesHeld[fid] ?? 0) >= AI_MAX_STAKE) continue;
    const val = companyValuation(state, fid).valuation;
    if (val > targetVal) {
      targetVal = val;
      target = fid;
    }
  }
  if (!target) return;

  const pricePerPct = Math.max(1, Math.round(targetVal / 100));
  const cost = 5 * pricePerPct;
  if (firm.cash - cost < AI_SHARE_CASH_FLOOR) return;

  recordTransaction(state, {
    from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
    firmId: null, category: 'none',
    note: `Bought 5% of ${state.firms[target]!.name}`,
  });
  firm.sharesHeld[target] = (firm.sharesHeld[target] ?? 0) + 5;
  const targetName = state.firms[target]!.name;
  emitEvent(state, 'info', 'ai',
    `${firm.name} bought a 5% stake in ${targetName} (now ${firm.sharesHeld[target]}%).${ceoQuote(rng, firm, 'shares')}`,
    target);
}

/**
 * Rescue consolidation: a very flush AI absorbs a distressed/insolvent AI
 * rival at the distressed discount instead of letting it die slowly. Keeps
 * the town's chains running under new ownership — and means the player isn't
 * the only consolidator in the market. Never targets the player.
 */
const RESCUE_CASH_FLOOR = 60000_00; // consider M&A above $60k cash
const RESCUE_KEEP_BUFFER = 30000_00; // never drop below $30k doing it

function maybeRescueAcquisition(ctx: SimContext, firmId: string): boolean {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.cash < RESCUE_CASH_FLOOR || !rng.chance(0.25)) return false;
  for (const fid in state.firms) {
    if (fid === firmId) continue;
    const other = state.firms[fid]!;
    if (other.ownerType !== 'ai' || other.bankruptcyStatus === 'healthy') continue;
    const cost = acquisitionCost(state, firmId, fid);
    if (firm.cash - cost < RESCUE_KEEP_BUFFER) continue;
    return performAcquisition(state, firmId, fid);
  }
  return false;
}

/**
 * AI trade: when a production facility is glutted with finished goods and
 * Port Rosa pays ≥1.2× base, sell surplus through a broker (steeper 15% fee
 * than the player's warehouse route — the player's logistics edge is real).
 * Keeps AI chains from stalling inventory-full and gives them trade income.
 */
const AI_EXPORT_FEE = 0.15;
const AI_EXPORT_MIN_MULT = 1.2;
const AI_EXPORT_KEEP = 20; // units kept as working stock

function maybeExportSurplus(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  const keep = Math.round(AI_EXPORT_KEEP * getPersonality(firm.personalityId).exportKeepMult);
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || (fac.type !== 'farm' && fac.type !== 'mine' && fac.type !== 'factory')) continue;
    for (const pid in fac.outputInventory) {
      const have = getQuantity(fac.outputInventory, pid);
      // Home shelves eat first: stock spoken for by active outbound supply
      // contracts is never exported, whatever the personality. Without this an
      // exporter firm ships its own shops' supply and starves the town
      // (measured: Port Haven satisfaction 1/100 by day 90 on every seed).
      let reserved = 0;
      for (const cid in state.contracts) {
        const c = state.contracts[cid]!;
        if (c.active && c.sourceFacilityId === fac.id && c.productId === pid) {
          reserved += c.targetQuantity;
        }
      }
      const keepHere = Math.max(keep, reserved);
      if (have <= keepHere + 10) continue;
      const product = getProduct(pid);
      // Brokered AI exports route to whichever city pays best today.
      const best = pickBestCity(state, pid);
      const cityName = getTradeCity(best.cityId).name;
      if (best.price < product.basePrice * AI_EXPORT_MIN_MULT) continue;
      const qty = Math.min(have - keepHere, 40);
      const revenue = Math.round(qty * best.price * (1 - AI_EXPORT_FEE));
      removeStock(fac.outputInventory, pid, qty);
      recordTransaction(state, {
        from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: revenue,
        firmId, category: 'revenue', productId: pid, quantity: qty,
        note: `Exported ${qty} ${product.name} to ${cityName} (brokered)`,
      });
      firm.exportRevenue += revenue;
      firm.exportRevenueByCity[best.cityId] = (firm.exportRevenueByCity[best.cityId] ?? 0) + revenue;
      if (revenue >= 200_00) {
        emitEvent(state, 'info', 'ai',
          `${firm.name} exported ${qty} ${product.name} to ${cityName} for ${formatMoney(revenue)}.${ceoQuote(rng, firm, 'export')}`, fac.id);
      }
      return; // one export per firm per day
    }
  }
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

function maybeEnterLuxury(ctx: SimContext, firmId: string): void {
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
    state.contracts[id] = contract;
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

function maybeEnterCoffee(ctx: SimContext, firmId: string): void {
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
  let store: import('../entities/Facility').Facility | null = null;
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
    state.contracts[id] = contract;
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
 * AI landlord: when the town has no vacant housing, a flush firm builds an
 * apartment near the residential blocks — immigration fills it, RentSystem
 * pays the owner. Keeps real estate a contested vertical, not a player-only
 * printing press, and keeps the growth flywheel spinning in AI-only towns.
 */
const LANDLORD_DAY = 30;
const LANDLORD_CASH = 35000_00;
const LANDLORD_CHANCE = 0.1;
const LANDLORD_MAX_APARTMENTS = 2;

function maybeBuildApartment(ctx: SimContext, firmId: string): void {
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

/** Flush AI firms level up a production facility now and then. */
function maybeUpgrade(ctx: SimContext, firmId: string): void {
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

/**
 * Deleverage: expansion loans are bridges, not permanent fixtures — at ~30%/yr
 * the interest quietly eats late-game margins if debt is never repaid. When
 * cash comfortably exceeds an operating cushion, pay the loan down. The cushion
 * keeps the firm able to expand again (borrowing back is always possible).
 */
const DEBT_CASH_CUSHION = 6000_00;
const DEBT_MIN_REPAYMENT = 100_00; // skip dribble payments

function manageDebt(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.debt <= 0) return;
  const spare = firm.cash - DEBT_CASH_CUSHION;
  if (spare < DEBT_MIN_REPAYMENT) return;
  const amount = Math.min(firm.debt, spare);
  firm.debt -= amount;
  recordTransaction(state, {
    from: firmAccount(firmId),
    to: WORLD_ACCOUNT,
    amount,
    firmId,
    category: 'loanRepay',
    note: 'Deleveraging',
  });
}

/**
 * Local sourcing: AI firms shop their input contracts. If a local firm (the
 * player included) holds a sustained surplus of something this firm imports,
 * and wholesale (~70% of market) meaningfully beats the importer's premium,
 * the contract is repointed at the local supplier — so a player who
 * overproduces intermediates gets real AI customers. The reverse guard: a
 * cross-firm-sourced contract whose destination has starved AND whose source
 * has no surplus left reverts to the dependable importer.
 * Deterministic (no rng): conditions, not coin flips.
 */
const LOCAL_SOURCE_MIN_SURPLUS = 40;
const LOCAL_SOURCE_SAVINGS = 0.9; // switch only if wholesale < importer × this


/**
 * Seller-side wholesale pricing: with paying customers on the line, creep the
 * asking price up (capped well under import parity so nobody walks); sitting
 * on unsold surplus, cut toward the personality's floor to win the next
 * cheapest-supplier scan. Together with buyers shopping around, this makes
 * wholesale a living market — Price Fighters dive to 55% and start wars,
 * Exporters barely discount because their surplus has a ship to catch.
 */
const WHOLESALE_MILK_CAP = 0.85;
const WHOLESALE_PRICE_STEP = 0.02;

function manageWholesalePricing(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const floor = getPersonality(firm.personalityId).wholesaleFloor;

  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type === 'retail' || fac.type === 'home' || fac.type === 'warehouse') continue;
    if (fac.wholesaleEnabled === false || fac.status === 'closed') continue;

    let customers = 0;
    for (const cid in state.contracts) {
      const c = state.contracts[cid]!;
      if (!c.active || c.sourceFacilityId !== fac.id) continue;
      if (state.facilities[c.destinationFacilityId]?.ownerFirmId !== firmId) customers++;
    }
    const mult = fac.wholesalePriceMult ?? WHOLESALE_DISCOUNT;
    if (customers > 0) {
      if (mult < WHOLESALE_MILK_CAP) {
        fac.wholesalePriceMult = Math.round(Math.min(WHOLESALE_MILK_CAP, mult + WHOLESALE_PRICE_STEP) * 100) / 100;
      }
    } else if (mult > floor) {
      // Only bother cutting when there is actually something to sell.
      let surplus = 0;
      for (const pid in fac.outputInventory) surplus += fac.outputInventory[pid]!.quantity;
      if (surplus >= 30) {
        fac.wholesalePriceMult = Math.round(Math.max(floor, mult - WHOLESALE_PRICE_STEP) * 100) / 100;
      }
    }
  }
}

function manageSourcing(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;

  for (const cid in state.contracts) {
    const contract = state.contracts[cid]!;
    if (!contract.active || contract.ownerFirmId !== firmId) continue;
    const source = state.facilities[contract.sourceFacilityId];
    const dest = state.facilities[contract.destinationFacilityId];
    if (!source || !dest || dest.ownerFirmId !== firmId) continue;
    const pid = contract.productId;

    if (source.type === 'importer') {
      // Consider switching to the CHEAPEST qualifying local supplier —
      // sellers set their own wholesale price, so undercutting wins the
      // customer.
      const product = getProduct(pid);
      const importerUnit = Math.round(product.basePrice * IMPORT_MARKUP * worldImportMult(state));
      let best: { fac: import('../entities/Facility').Facility; unit: number } | null = null;
      for (const fid in state.facilities) {
        const fac = state.facilities[fid]!;
        if (fac.ownerFirmId === firmId || fac.type === 'importer' || fac.status === 'closed') continue;
        // Warehouses are staging areas (often export stockpiles) — never
        // treat them as shops; and respect the owner's wholesale opt-out.
        if (fac.type === 'warehouse' || fac.wholesaleEnabled === false) continue;
        const sellerType = state.firms[fac.ownerFirmId]?.ownerType;
        if (sellerType !== 'ai' && sellerType !== 'player') continue;
        if (localSurplus(state, fac, pid) < LOCAL_SOURCE_MIN_SURPLUS) continue;
        const unit = wholesaleUnitPrice(state, fac, pid);
        if (unit >= importerUnit * LOCAL_SOURCE_SAVINGS) continue; // not enough savings
        if (!best || unit < best.unit) best = { fac, unit };
      }
      if (best) {
        contract.sourceFacilityId = best.fac.id;
        emitEvent(state, 'info', 'ai',
          `${firm.name} now sources ${product.name} locally from ${state.firms[best.fac.ownerFirmId]!.name} — wholesale beats the importer.`,
          dest.id);
        return; // one switch per firm per day
      }
    } else if (source.ownerFirmId !== firmId) {
      // Cross-firm source opted out (revert immediately — that source will
      // never ship again), priced itself above import parity (no one pays a
      // local MORE than the importer), or dried up while the destination
      // starves: go back to the importer rather than die of loyalty.
      const cutOff = source.wholesaleEnabled === false;
      const importerUnit = Math.round(
        getProduct(pid).basePrice * IMPORT_MARKUP * worldImportMult(state),
      );
      const curUnit = wholesaleUnitPrice(state, source, pid);
      const gouged = curUnit > importerUnit;
      const destHave = getQuantity(dest.inputInventory, pid);
      if (!cutOff && !gouged && (destHave > 0 || localSurplus(state, source, pid) >= 10)) {
        // Healthy relationship — but loyalty has a price. If a rival supplier
        // undercuts the current one by 10%+, take the better deal.
        for (const fid in state.facilities) {
          const fac = state.facilities[fid]!;
          if (fac.id === source.id || fac.ownerFirmId === firmId) continue;
          if (fac.type === 'importer' || fac.type === 'warehouse' || fac.status === 'closed') continue;
          if (fac.wholesaleEnabled === false) continue;
          const sellerType = state.firms[fac.ownerFirmId]?.ownerType;
          if (sellerType !== 'ai' && sellerType !== 'player') continue;
          if (localSurplus(state, fac, pid) < LOCAL_SOURCE_MIN_SURPLUS) continue;
          if (wholesaleUnitPrice(state, fac, pid) > curUnit * 0.9) continue;
          contract.sourceFacilityId = fac.id;
          emitEvent(state, 'info', 'ai',
            `${firm.name} moved its ${getProduct(pid).name} order to ${state.firms[fac.ownerFirmId]!.name} — a sharper wholesale price.`,
            dest.id);
          return; // one switch per firm per day
        }
        continue;
      }
      const importer = Object.values(state.facilities).find((f) => f.type === 'importer');
      if (!importer) continue;
      contract.sourceFacilityId = importer.id;
      emitEvent(state, 'info', 'ai',
        gouged && !cutOff
          ? `${firm.name} dropped ${state.firms[source.ownerFirmId]?.name ?? 'a supplier'} for ${getProduct(pid).name} — pricier than importing.`
          : `${firm.name} switched ${getProduct(pid).name} sourcing back to the importer — the local supplier ran dry.`,
        dest.id);
      return;
    }
  }
}

/**
 * Wage counterplay: labor is a market too. When a firm has unfilled slots and
 * the unemployed pool is dry (usually because the player out-paid everyone),
 * it raises its base wage toward a cap; with a full roster and slack labor it
 * drifts back down. Keeps the player's wage lever powerful but not free.
 */
const AI_WAGE_CAP_MULT = 1.5; // × the firm's starting wage
const AI_WAGE_RAISE = 1.04; // per tight-labor day
const AI_WAGE_DECAY = 0.98; // per slack day above the floor

function manageWages(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const floor = firm.strategy.startingWage ?? firm.wagePolicy.baseWage;
  if (!firm.strategy.startingWage) firm.strategy.startingWage = floor;

  let unfilled = 0;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    const desired = fac.activeRecipeId
      ? Math.min(fac.workerCapacity, getRecipe(fac.activeRecipeId).laborRequired)
      : fac.type === 'retail'
        ? Math.min(fac.workerCapacity, 2)
        : 0;
    unfilled += Math.max(0, desired - fac.employees.length);
  }
  let unemployed = 0;
  for (const cid in state.citizens) {
    if (state.citizens[cid]!.employmentStatus === 'unemployed') unemployed += 1;
  }

  const wage = firm.wagePolicy.baseWage;
  let next = wage;
  if (unfilled > 0 && unemployed === 0 && firm.cash > 10000_00) {
    next = Math.min(Math.round(floor * AI_WAGE_CAP_MULT), Math.round(wage * AI_WAGE_RAISE));
  } else if (unfilled === 0 && unemployed >= 3 && wage > floor) {
    next = Math.max(floor, Math.round(wage * AI_WAGE_DECAY));
  }
  if (next !== wage) {
    firm.wagePolicy.baseWage = next;
    // Current staff ride the same wage — retention parity with SET_WAGE.
    for (const cid of firm.employees) {
      const cit = state.citizens[cid];
      if (cit) cit.wage = next;
    }
    if (next > wage) {
      emitEvent(state, 'info', 'ai',
        `${firm.name} raised wages to ${formatMoney(next)}/day to attract scarce workers.`, firm.id);
    }
  }
}

/**
 * Supply elasticity: when a firm's product shows chronic unmet demand, it
 * staffs its production facility BEYOND the recipe's labor requirement —
 * over-crewing scales output up to 2.5× (the same growth lever the player
 * has). Without this, one bakery feeds the whole town forever and every
 * demand-side addition tips the staple market into permanent shortage.
 */
function maybeBoostProduction(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  // Expansion only while the business is actually working: without the
  // loss-streak brake, chronic-shortage hiring bloats payroll past revenue
  // and the whole AI economy death-spirals by day ~300 (measured in soak).
  if (firm.cash < 15000_00 || firm.strategy.lossStreak > 0) {
    if (firm.strategy.lossStreak >= 3) trimProduction(ctx, firmId);
    return;
  }
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed' || !fac.activeRecipeId) continue;
    const outPid = getRecipe(fac.activeRecipeId).outputs[0]?.productId;
    if (!outPid) continue;
    const yesterday = state.marketStats[outPid]?.history.slice(-1)[0];
    const finished = state.marketStats[
      getFinishedProductFor(state, fac, outPid)
    ]?.history.slice(-1)[0];
    const signal = finished ?? yesterday;
    if (!signal || signal.unmetDemand <= signal.unitsSold) continue;

    if (fac.employees.length < fac.workerCapacity) {
      const cid = findUnemployed(state);
      if (!cid || !hireCitizen(state, fac.id, cid)) continue;
      return; // one boost per firm per day
    }
    // Fully crewed and still short: the next rung of elasticity is a level
    // upgrade (+1 worker slot, +15% speed) — cheaper gates than the vanity
    // upgrades in maybeUpgrade, because chronic shortage is a real signal
    // (measured: a grown town of 56 pins every facility at capacity/L1).
    if (fac.level < MAX_FACILITY_LEVEL) {
      const cost = upgradeCost(state, fac.id);
      if (firm.cash - cost >= 15000_00) {
        upgradeFacility(state, firmId, fac.id);
        return;
      }
      continue;
    }
    // Maxed out and STILL short: the last rung duplicates the whole
    // production sub-chain (producer + factory together). Duplicating only
    // one stage was measured to backfire — a second bakery fed by the same
    // single farm starves both. Trigger on factories; the paired producer
    // comes along.
    if (fac.type === 'factory' && buildSiblingChain(ctx, firmId, fac.id)) return;
  }
}

/** How many of this firm's facilities run the given recipe. */
function countRecipe(state: import('../core/GameState').GameState, firmId: string, recipeId: string): number {
  let n = 0;
  const firm = state.firms[firmId]!;
  for (const fid of firm.facilities) {
    if (state.facilities[fid]?.activeRecipeId === recipeId) n += 1;
  }
  return n;
}

const SIBLING_CAP_PER_RECIPE = 2;

function buildSiblingChain(ctx: SimContext, firmId: string, factoryId: string): boolean {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  const factory = state.facilities[factoryId]!;
  if (!factory.activeRecipeId) return false;
  if (countRecipe(state, firmId, factory.activeRecipeId) >= SIBLING_CAP_PER_RECIPE) return false;

  // The producer feeding this factory (via its input contract), if the firm
  // owns one — otherwise the importer supplies the sibling too.
  let producer: import('../entities/Facility').Facility | null = null;
  let inputContract: Contract | null = null;
  for (const cid in state.contracts) {
    const c = state.contracts[cid]!;
    if (!c.active || c.destinationFacilityId !== factoryId) continue;
    inputContract = c;
    const src = state.facilities[c.sourceFacilityId];
    if (src && src.ownerFirmId === firmId && src.activeRecipeId) producer = src;
    break;
  }

  const jit = () => rng.jitter(4);
  const facLoc = {
    x: clamp(factory.location.x + (rng.chance(0.5) ? 12 : -12) + jit(), 8, state.config.mapWidth - 8),
    y: clamp(factory.location.y + jit(), 8, state.config.mapHeight - 8),
  };
  const facDef = getFacilityDef(factory.defId);
  const facCost = Math.round(facDef.buildCost * landCostMultiplier(landValueAt(state, facLoc)));
  let prodCost = 0;
  let prodLoc: { x: number; y: number } | null = null;
  if (producer) {
    prodLoc = {
      x: clamp(producer.location.x + (rng.chance(0.5) ? 12 : -12) + jit(), 8, state.config.mapWidth - 8),
      y: clamp(producer.location.y + jit(), 8, state.config.mapHeight - 8),
    };
    prodCost = Math.round(getFacilityDef(producer.defId).buildCost * landCostMultiplier(landValueAt(state, prodLoc)));
  }
  if (firm.cash - (facCost + prodCost) < 20000_00) return false;

  const build = (defId: string, loc: { x: number; y: number }, cost: number, name: string, recipeId: string) => {
    const fac = createFacility(state, defId, firmId, loc, { name });
    fac.activeRecipeId = recipeId;
    fac.buildCost = cost;
    fac.operatingCostPerDay = Math.round(getFacilityDef(defId).maintenanceCostPerDay * landCostMultiplier(landValueAt(state, loc)));
    recordTransaction(state, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
      firmId, category: 'buildSpend', note: `Built ${name}`,
    });
    const labor = getRecipe(recipeId).laborRequired;
    for (let i = 0; i < labor; i++) {
      const cid = findUnemployed(state);
      if (!cid || !hireCitizen(state, fac.id, cid)) break;
    }
    return fac;
  };

  const factory2 = build(factory.defId, facLoc, facCost, `${factory.name} II`, factory.activeRecipeId);
  const wire = (src: string, dest: string, base: Contract): void => {
    const id = nextId(state.idCounters, 'ctr');
    state.contracts[id] = { ...base, id, sourceFacilityId: src, destinationFacilityId: dest };
  };

  if (producer && prodLoc && producer.activeRecipeId && inputContract) {
    const producer2 = build(producer.defId, prodLoc, prodCost, `${producer.name} II`, producer.activeRecipeId);
    wire(producer2.id, factory2.id, inputContract); // own grain for the new line
  } else if (inputContract) {
    wire(inputContract.sourceFacilityId, factory2.id, inputContract); // importer-fed
  }
  // The new line ships to the same destinations as the original factory.
  for (const cid in state.contracts) {
    const c = state.contracts[cid]!;
    if (c.active && c.sourceFacilityId === factoryId) {
      wire(factory2.id, c.destinationFacilityId, c);
    }
  }

  emitEvent(state, 'info', 'ai',
    `🏗️ ${firm.name} doubled its production line: ${factory2.name} is running.${ceoQuote(rng, firm, 'expand')}`, factory2.id);
  return true;
}

/**
 * Shelf elasticity: production scaling is useless if the supply contracts
 * feeding the stores stay sized for the old volume — the surplus just piles
 * up (or ships to Port Rosa) while shelves stock out. When a store keeps
 * losing sales, widen its inbound contracts.
 *
 * Also runs for the player's auto-priced ("managed") products: wizard chains
 * ship with 40-unit contracts, and once demand outgrows them the store
 * famine-feasts on alternate-day deliveries while the factory drowns in
 * stock (measured: 95/100 days with lostSales>5 AND factory backlog ≥40).
 * `managedOnly` keeps hands off any product the player prices manually.
 */
const SHELF_WIDEN_LOST_SALES = 5;
const SHELF_TARGET_STEP = 10;
const SHELF_TARGET_CAP = 120;

function maybeWidenShelves(ctx: SimContext, firmId: string, managedOnly = false): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail') continue;
    if (fac.dailyStats.lostSales <= SHELF_WIDEN_LOST_SALES) continue;
    for (const cid in state.contracts) {
      const c = state.contracts[cid]!;
      if (!c.active || c.destinationFacilityId !== facId) continue;
      if (managedOnly && !firm.autoPriceByProduct[c.productId]) continue;
      if (c.targetQuantity >= SHELF_TARGET_CAP) continue;
      c.targetQuantity = Math.min(SHELF_TARGET_CAP, c.targetQuantity + SHELF_TARGET_STEP);
      c.maxInventory = Math.max(c.maxInventory, Math.round(c.targetQuantity * 1.8));
      c.reorderPoint = Math.max(c.reorderPoint, Math.round(c.targetQuantity * 0.4));
      return; // one widening per firm per day
    }
  }
}

/**
 * The other half of supply elasticity: a firm bleeding money sheds one
 * over-requirement worker per day from its most over-crewed production
 * facility, back down to the recipe's labor requirement. Boom hiring must
 * be reversible or booms end in insolvency instead of equilibrium.
 */
function trimProduction(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  let target: string | null = null;
  let mostExcess = 0;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || !fac.activeRecipeId) continue;
    const excess = fac.employees.length - getRecipe(fac.activeRecipeId).laborRequired;
    if (excess > mostExcess) {
      mostExcess = excess;
      target = facId;
    }
  }
  if (!target) return;
  const fac = state.facilities[target]!;
  const cid = fac.employees[fac.employees.length - 1];
  if (cid) fireCitizen(state, target, cid);
}

/**
 * The consumer product a raw producer ultimately feeds (grain -> bread for a
 * bakery-owning firm), so shortage signals reach upstream. Falls back to the
 * facility's own output.
 */
function getFinishedProductFor(
  state: import('../core/GameState').GameState,
  fac: import('../entities/Facility').Facility,
  outPid: string,
): string {
  for (const cid in state.contracts) {
    const c = state.contracts[cid]!;
    if (!c.active || c.sourceFacilityId !== fac.id || c.productId !== outPid) continue;
    const dest = state.facilities[c.destinationFacilityId];
    if (dest?.activeRecipeId) {
      const finished = getRecipe(dest.activeRecipeId).outputs[0]?.productId;
      if (finished && finished !== outPid) return finished;
    }
  }
  return outPid;
}

function restaff(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    let desired = Math.min(fac.workerCapacity, 2);
    if (fac.activeRecipeId) {
      desired = Math.min(fac.workerCapacity, getRecipe(fac.activeRecipeId).laborRequired);
    } else if (fac.type === 'retail') {
      desired = Math.min(fac.workerCapacity, 2);
    }
    while (fac.employees.length < desired) {
      // Only hire if the firm can cover a few days of wages.
      if (!canAfford(state, firmAccount(firmId), firm.wagePolicy.baseWage * 3)) break;
      const cid = findUnemployed(state);
      if (!cid) break;
      if (!hireCitizen(state, fac.id, cid)) break;
    }
  }
}

function adjustPrices(ctx: SimContext, firmId: string, onlyAutoPriced = false): void {
  const { state, config, rng } = ctx;
  const firm = state.firms[firmId]!;
  const losing = firm.strategy.lossStreak >= 3;
  // Personality tilts cut depth and the penetration target (neutral for the
  // player's auto-priced products — firm.personalityId is null there).
  const persona = getPersonality(firm.personalityId);

  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail') continue;
    for (const pid of fac.retailProductIds) {
    if (onlyAutoPriced && !firm.autoPriceByProduct[pid]) continue;
    const product = getProduct(pid);
    const base = product.basePrice;
    const stock = getQuantity(fac.inputInventory, pid);
    const lost = fac.dailyStats.lostSales;
    const step = rng.range(config.aiPriceStepMin, config.aiPriceStepMax);

    const sold = fac.dailyStats.unitsSold;
    let price = firm.pricesByProduct[pid] ?? base;

    // Excess demand: was actively selling AND ran out -> raise.
    const excessDemand = lost > 0 && sold > 0 && stock <= 2;
    // Priced out of the market: has stock but sold nothing -> cut decisively.
    const pricedOut = stock > 0 && sold === 0;
    // Affordability thermostat: shoppers came, looked at the price, and walked
    // away outnumbering actual buyers. Without this signal the market-power
    // drift rides quality/brand premiums right past what the town can afford
    // and the whole demand side quietly dies (measured: seed-1 town falls
    // from sat 63 to 28 by day 120 without it).
    const unaffordable =
      !excessDemand && fac.dailyStats.pricedOut > Math.max(2, sold);
    // Surplus: held meaningful stock without selling out -> gently lower.
    const surplus = lost === 0 && stock > 5 && !pricedOut && !unaffordable;

    if (excessDemand) {
      firm.strategy.selloutStreak[pid] = (firm.strategy.selloutStreak[pid] ?? 0) + 1;
      firm.strategy.gluttStreak[pid] = 0;
      price *= 1 + step;
      if ((firm.strategy.selloutStreak[pid] ?? 0) === 3) {
        emitEvent(
          state,
          'info',
          'ai',
          `${firm.name} raised ${product.name} prices after repeated sellouts.${ceoQuote(rng, firm, 'price')}`,
          firm.id,
        );
      }
    } else if (pricedOut || unaffordable) {
      firm.strategy.gluttStreak[pid] = (firm.strategy.gluttStreak[pid] ?? 0) + 1;
      firm.strategy.selloutStreak[pid] = 0;
      price *= 1 - Math.min(0.2, Math.max(step, 0.06) * persona.priceCutMult); // cut hard when demand can't reach the price
    } else if (surplus) {
      firm.strategy.gluttStreak[pid] = (firm.strategy.gluttStreak[pid] ?? 0) + 1;
      firm.strategy.selloutStreak[pid] = 0;
      price *= 1 - step * 0.5 * persona.priceCutMult; // gentle
    } else if ((firm.marketShareByProduct[pid] ?? 0) < 0.12 && stock > 5) {
      // Market entrant with stock but no share: penetration pricing — dive
      // toward the persona's target (default 78% of base) to buy customers,
      // then normal control takes over.
      firm.strategy.selloutStreak[pid] = 0;
      firm.strategy.gluttStreak[pid] = 0;
      price += (base * persona.penetrationTarget - price) * 0.25;
    } else {
      // Selling steadily: drift toward a market-power target — winners charge
      // a premium (up to ~1.45× base at dominant share); brand/quality raise
      // willingness-to-pay to match. Surplus/priced-out branches still cut,
      // so overreach self-corrects.
      firm.strategy.selloutStreak[pid] = 0;
      firm.strategy.gluttStreak[pid] = 0;
      const share = firm.marketShareByProduct[pid] ?? 0;
      const target = base * (1 + Math.min(0.45, share * 0.55));
      price += (target - price) * 0.1;
    }

    // Defend margin only while the product is actually moving.
    if (losing && sold > 0) price *= 1 + step * 0.5;

    price = clamp(price, base * config.aiPriceFloorMult, base * config.aiPriceCeilMult);
    firm.pricesByProduct[pid] = Math.round(price);
    }
  }
}
