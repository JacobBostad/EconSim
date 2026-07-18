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
import { hireCitizen, findUnemployed } from './LaborSystem';
import { clamp } from '../../utils/clamp';
import { CENTS, RND_QUALITY_GAIN_PER_1000 } from '../data/constants';
import { companyValuation } from '../selectors/companySelectors';
import { acquisitionCost, performAcquisition } from '../core/Acquisition';
import { landCostMultiplier, landValueAt } from '../core/LandValue';
import { MAX_FACILITY_LEVEL, upgradeCost, upgradeFacility } from '../core/Upgrades';
import { getPersonality, ceoQuote } from '../data/personalities';

export function runAIStrategySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    if (firm.bankruptcyStatus !== 'insolvent') {
      manageWages(ctx, firm.id);
      restaff(ctx, firm.id);
    }
    adjustPrices(ctx, firm.id);
    if (firm.bankruptcyStatus === 'healthy') {
      manageAdBudget(ctx, firm.id);
      maybeInvestQuality(ctx, firm.id);
      maybeExpand(ctx, firm.id);
      maybeBuyShares(ctx, firm.id);
      maybeExportSurplus(ctx, firm.id);
      maybeUpgrade(ctx, firm.id);
      maybeEnterLuxury(ctx, firm.id);
      if (maybeRescueAcquisition(ctx, firm.id)) continue; // firm map changed
    }

    // Track loss streak.
    const op = operatingProfit(firm.accounting.today);
    firm.strategy.lossStreak = op < 0 ? firm.strategy.lossStreak + 1 : 0;
  }

  // Player QoL: the same mean-reverting price controller manages any player
  // product with auto-price enabled.
  const player = state.firms[state.playerFirmId];
  if (player && Object.values(player.autoPriceByProduct).some(Boolean)) {
    adjustPrices(ctx, player.id, true);
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
      const tradePrice = state.tradeCity.pricesByProduct[pid] ?? product.basePrice;
      if (tradePrice < product.basePrice * AI_EXPORT_MIN_MULT) continue;
      const qty = Math.min(have - keepHere, 40);
      const revenue = Math.round(qty * tradePrice * (1 - AI_EXPORT_FEE));
      removeStock(fac.outputInventory, pid, qty);
      recordTransaction(state, {
        from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: revenue,
        firmId, category: 'revenue', productId: pid, quantity: qty,
        note: `Exported ${qty} ${product.name} to Port Rosa (brokered)`,
      });
      firm.exportRevenue += revenue;
      if (revenue >= 200_00) {
        emitEvent(state, 'info', 'ai',
          `${firm.name} exported ${qty} ${product.name} to Port Rosa for ${revenue}¢.${ceoQuote(rng, firm, 'export')}`, fac.id);
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
        `${firm.name} raised wages to ${next}¢/day to attract scarce workers.`, firm.id);
    }
  }
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
