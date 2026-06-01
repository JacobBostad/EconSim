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
import { emitEvent, canAfford } from '../core/GameState';
import { firmAccount } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { operatingProfit } from '../entities/Accounting';
import { getProduct } from '../data/products';
import { getRecipe } from '../data/recipes';
import { getQuantity } from '../entities/Inventory';
import { getFacilityDef } from '../data/facilityDefinitions';
import { hireCitizen, findUnemployed } from './LaborSystem';
import { clamp } from '../../utils/clamp';

export function runAIStrategySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    if (firm.bankruptcyStatus !== 'insolvent') restaff(ctx, firm.id);
    adjustPrices(ctx, firm.id);

    // Track loss streak.
    const op = operatingProfit(firm.accounting.today);
    firm.strategy.lossStreak = op < 0 ? firm.strategy.lossStreak + 1 : 0;
  }
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

function adjustPrices(ctx: SimContext, firmId: string): void {
  const { state, config, rng } = ctx;
  const firm = state.firms[firmId]!;
  const losing = firm.strategy.lossStreak >= 3;

  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail' || !fac.retailProductId) continue;
    const pid = fac.retailProductId;
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
