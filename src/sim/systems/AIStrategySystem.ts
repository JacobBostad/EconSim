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
import { getQuantity } from '../entities/Inventory';
import { getFacilityDef } from '../data/facilityDefinitions';
import { createFacility } from '../entities/factories';
import type { Contract } from '../entities/Contract';
import { hireCitizen, findUnemployed } from './LaborSystem';
import { clamp } from '../../utils/clamp';
import { CENTS, RND_QUALITY_GAIN_PER_1000 } from '../data/constants';
import { companyValuation } from '../selectors/companySelectors';

export function runAIStrategySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    if (firm.bankruptcyStatus !== 'insolvent') restaff(ctx, firm.id);
    adjustPrices(ctx, firm.id);
    if (firm.bankruptcyStatus === 'healthy') {
      manageAdBudget(ctx, firm.id);
      maybeInvestQuality(ctx, firm.id);
      maybeExpand(ctx, firm.id);
      maybeBuyShares(ctx, firm.id);
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
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail' || !fac.retailProductId) continue;
    const pid = fac.retailProductId;
    const share = firm.marketShareByProduct[pid] ?? 0;
    const budget = firm.adBudgetByProduct[pid] ?? 0;
    if (firm.strategy.lossStreak >= 3 || share > 0.7) {
      // Bleeding or dominant: dial spend down toward the floor.
      if (budget > AD_BUDGET_FLOOR) {
        firm.adBudgetByProduct[pid] = Math.max(AD_BUDGET_FLOOR, budget - AD_BUDGET_STEP / 2);
      }
    } else if (share < 0.5 && firm.cash > 15000_00 && budget < AD_BUDGET_CAP) {
      firm.adBudgetByProduct[pid] = Math.min(AD_BUDGET_CAP, budget + AD_BUDGET_STEP);
      if (budget + AD_BUDGET_STEP >= AD_BUDGET_CAP) {
        emitEvent(state, 'info', 'ai',
          `${firm.name} is running a maximum ad campaign for ${getProduct(pid).name}.`, firm.id);
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
    if (!fac || fac.type !== 'retail' || !fac.retailProductId) continue;
    const pid = fac.retailProductId;
    const cur = firm.qualityByProduct[pid] ?? getProduct(pid).defaultQuality;
    const behindRival = bestRivalQuality(ctx, firmId, pid) > cur + 5;
    if (!behindRival && !rng.chance(0.15)) return;
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
    if (!fac.retailProductId) continue;
    product = fac.retailProductId;
    lost += fac.dailyStats.lostSales;
  }
  if (!product) return;
  const stat = state.marketStats[product]!;
  if (stat.unmetDemand < 14 || lost < 6) return; // only under real shortage
  if (!rng.chance(ctx.config.aiExpandChance)) return; // not every eligible day

  const def = getFacilityDef('retail');
  const cost = def.buildCost;
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

  // Place near the commercial belt with deterministic jitter.
  const loc = { x: clamp(54 + stores.length * 12 + rng.jitter(5), 8, state.config.mapWidth - 8), y: clamp(50 + rng.jitter(6), 8, state.config.mapHeight - 8) };
  const fac = createFacility(state, 'retail', firmId, loc, { name: `${firm.name.split(' ')[0]} Outlet ${stores.length + 1}` });
  fac.retailProductId = product;
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
  emitEvent(state, 'info', 'ai', `${firm.name} opened a new outlet to meet demand for ${getProduct(product).name}.`, fac.id);
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
    `${firm.name} bought a 5% stake in ${targetName} (now ${firm.sharesHeld[target]}%).`,
    target);
}

function restaff(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    const def = getFacilityDef(fac.defId);
    let desired = Math.min(def.workerCapacity, 2);
    if (fac.activeRecipeId) {
      desired = Math.min(def.workerCapacity, getRecipe(fac.activeRecipeId).laborRequired);
    } else if (fac.type === 'retail') {
      desired = Math.min(def.workerCapacity, 2);
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

  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail' || !fac.retailProductId) continue;
    const pid = fac.retailProductId;
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
    // Surplus: held meaningful stock without selling out -> gently lower.
    const surplus = lost === 0 && stock > 5 && !pricedOut;

    if (excessDemand) {
      firm.strategy.selloutStreak[pid] = (firm.strategy.selloutStreak[pid] ?? 0) + 1;
      firm.strategy.gluttStreak[pid] = 0;
      price *= 1 + step;
      if ((firm.strategy.selloutStreak[pid] ?? 0) === 3) {
        emitEvent(
          state,
          'info',
          'ai',
          `${firm.name} raised ${product.name} prices after repeated sellouts.`,
          firm.id,
        );
      }
    } else if (pricedOut) {
      firm.strategy.gluttStreak[pid] = (firm.strategy.gluttStreak[pid] ?? 0) + 1;
      firm.strategy.selloutStreak[pid] = 0;
      price *= 1 - Math.max(step, 0.06); // cut hard when nothing sells
    } else if (surplus) {
      firm.strategy.gluttStreak[pid] = (firm.strategy.gluttStreak[pid] ?? 0) + 1;
      firm.strategy.selloutStreak[pid] = 0;
      price *= 1 - step * 0.5; // gentle
    } else {
      // Selling steadily without sellout: mean-revert toward base price.
      firm.strategy.selloutStreak[pid] = 0;
      firm.strategy.gluttStreak[pid] = 0;
      price += (base - price) * 0.1;
    }

    // Defend margin only while the product is actually moving.
    if (losing && sold > 0) price *= 1 + step * 0.5;

    price = clamp(price, base * config.aiPriceFloorMult, base * config.aiPriceCeilMult);
    firm.pricesByProduct[pid] = Math.round(price);
  }
}
