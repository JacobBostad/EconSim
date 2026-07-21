/**
 * ai/OperatorBehavior.ts — the "operator" firm archetype: the full shopkeeper
 * loop every AI firm runs today (Arc D1). This is a VERBATIM code move of the
 * old AIStrategySystem per-firm loop body plus its helpers — a pure refactor,
 * no logic change — split out from the dispatcher so D2–D4 can add landlord /
 * investor / service archetypes as sibling modules without touching this path.
 *
 * It carries the behaviors that STAY operator forever: pricing, labor, supply
 * elasticity, sourcing and wholesale pricing. The build behaviors (expansion.ts)
 * and capital behaviors (finance.ts) live in sibling modules — they hold the
 * D2/D3/D4 archetype seams — but the operator orchestrator still calls them in
 * the exact original order, so every preset (Village included) is bit-identical
 * by structure.
 */

import type { SimContext } from '../../core/GameState';
import { emitEvent, canAfford, recordTransaction, addContract, reindexContracts } from '../../core/GameState';
import { contractsBySource, contractsByDest, contractsByOwner } from '../../core/ContractIndex';
import { firmAccount, WORLD_ACCOUNT } from '../../core/Transactions';
import { formatMoney } from '../../../utils/formatMoney';
import { nextId } from '../../core/Id';
import { operatingProfit } from '../../entities/Accounting';
import { getProduct } from '../../data/products';
import { getRecipe } from '../../data/recipes';
import { getQuantity } from '../../entities/Inventory';
import { getFacilityDef } from '../../data/facilityDefinitions';
import { createFacility } from '../../entities/factories';
import type { Contract } from '../../entities/Contract';
import { hireCitizen, fireCitizen, findUnemployed } from '../LaborSystem';
import { clamp } from '../../../utils/clamp';
import { CENTS, RND_QUALITY_GAIN_PER_1000, IMPORT_MARKUP, WHOLESALE_DISCOUNT } from '../../data/constants';
import { wholesaleUnitPrice, localSurplus } from '../../core/Wholesale';
import { worldImportMult } from '../../data/worldEvents';
import { landCostMultiplier, landValueAt } from '../../core/LandValue';
import { MAX_FACILITY_LEVEL, upgradeCost, upgradeFacility } from '../../core/Upgrades';
import { getPersonality, ceoQuote } from '../../data/personalities';
import { PREMIUM_QUALITY_THRESHOLD } from '../TierSystem';
import { routeRoutine, type DigestBuffer } from './digest';
import {
  maybeExpand,
  maybeUpgrade,
  maybeBuildApartment,
  maybeBuildDatacenter,
  maybeEnterCoffee,
  maybeEnterLuxury,
} from './expansion';
import {
  maybeBuyShares,
  maybeRescueAcquisition,
  maybeExportSurplus,
  manageDebt,
} from './finance';

// ============================================================================
// Pricing, positioning, advertising, quality
// ============================================================================

/**
 * Store positioning by personality: price fighters run discount formats
 * (worker footfall over margin), brand builders go premium (their ad/quality
 * spend earns the sign). Deterministic — no rng draws — and each store
 * converts at most once, so this is a one-time identity choice, not churn.
 * Premium conversion waits for the firm's quality investment to reach the
 * bar on at least one shelf product, matching the "earned sign" rule.
 */
function managePositioning(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const desired =
    firm.personalityId === 'price_fighter'
      ? 'discount'
      : firm.personalityId === 'brand_builder'
        ? 'premium'
        : null;
  if (!desired) return;
  let converted = false;
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail' || fac.positioning !== 'standard') continue;
    if (desired === 'premium') {
      const qualityReady = fac.retailProductIds.some(
        (pid) => (firm.qualityByProduct[pid] ?? 50) >= PREMIUM_QUALITY_THRESHOLD,
      );
      if (!qualityReady) continue;
    }
    fac.positioning = desired;
    converted = true;
  }
  if (converted) {
    emitEvent(state, 'info', 'ai',
      desired === 'discount'
        ? `🏷️ ${firm.name} converts its stores to a discount format — everyday low prices, working-class crowds.`
        : `✨ ${firm.name} takes its stores upmarket — premium fittings, premium prices.`,
      firm.id);
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
export function trimManagedAds(ctx: SimContext, firmId: string): void {
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

export function adjustPrices(
  ctx: SimContext,
  firmId: string,
  onlyAutoPriced = false,
  onlyFacilityId?: string,
  digest?: DigestBuffer,
): void {
  const { state, config, rng } = ctx;
  const firm = state.firms[firmId]!;
  const losing = firm.strategy.lossStreak >= 3;
  // Personality tilts cut depth and the penetration target (neutral for the
  // player's auto-priced products — firm.personalityId is null there).
  const persona = getPersonality(firm.personalityId);

  for (const facId of firm.facilities) {
    if (onlyFacilityId && facId !== onlyFacilityId) continue;
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
        routeRoutine(
          state,
          digest,
          'price',
          firm.id,
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

// ============================================================================
// Labor, supply elasticity, shelf sizing
// ============================================================================

/**
 * Wage counterplay: labor is a market too. When a firm has unfilled slots and
 * the unemployed pool is dry (usually because the player out-paid everyone),
 * it raises its base wage toward a cap; with a full roster and slack labor it
 * drifts back down. Keeps the player's wage lever powerful but not free.
 */
const AI_WAGE_CAP_MULT = 1.5; // × the firm's starting wage
const AI_WAGE_RAISE = 1.04; // per tight-labor day
const AI_WAGE_DECAY = 0.98; // per slack day above the floor

function manageWages(ctx: SimContext, firmId: string, digest?: DigestBuffer): void {
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
      routeRoutine(state, digest, 'wages', firm.id,
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
      getFinishedProductFor(state, fac, outPid, ctx.contractIndex)
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
function countRecipe(state: import('../../core/GameState').GameState, firmId: string, recipeId: string): number {
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
  let producer: import('../../entities/Facility').Facility | null = null;
  let inputContract: Contract | null = null;
  for (const cid of contractsByDest(ctx.contractIndex, factoryId)) {
    const c = state.contracts[cid]!;
    if (!c.active) continue;
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
    addContract(ctx, { ...base, id, sourceFacilityId: src, destinationFacilityId: dest });
  };

  if (producer && prodLoc && producer.activeRecipeId && inputContract) {
    const producer2 = build(producer.defId, prodLoc, prodCost, `${producer.name} II`, producer.activeRecipeId);
    wire(producer2.id, factory2.id, inputContract); // own grain for the new line
  } else if (inputContract) {
    wire(inputContract.sourceFacilityId, factory2.id, inputContract); // importer-fed
  }
  // The new line ships to the same destinations as the original factory. Snapshot
  // the source bucket first: wiring appends new contracts (sourced from the new
  // factory, a different bucket), so this list of the original line's outbound
  // contracts stays fixed as we iterate — matching the original scan, which
  // never revisited the contracts it was adding.
  for (const cid of [...contractsBySource(ctx.contractIndex, factoryId)]) {
    const c = state.contracts[cid]!;
    if (c.active) {
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

export function maybeWidenShelves(
  ctx: SimContext,
  firmId: string,
  managedOnly = false,
  onlyFacilityId?: string,
): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  for (const facId of firm.facilities) {
    if (onlyFacilityId && facId !== onlyFacilityId) continue;
    const fac = state.facilities[facId];
    if (!fac || fac.type !== 'retail') continue;
    if (fac.dailyStats.lostSales <= SHELF_WIDEN_LOST_SALES) continue;
    for (const cid of contractsByDest(ctx.contractIndex, facId)) {
      const c = state.contracts[cid]!;
      if (!c.active) continue;
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
  state: import('../../core/GameState').GameState,
  fac: import('../../entities/Facility').Facility,
  outPid: string,
  index: import('../../core/ContractIndex').ContractIndex,
): string {
  for (const cid of contractsBySource(index, fac.id)) {
    const c = state.contracts[cid]!;
    if (!c.active || c.productId !== outPid) continue;
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

// ============================================================================
// Sourcing and wholesale pricing
// ============================================================================

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

export function manageSourcing(ctx: SimContext, firmId: string, digest?: DigestBuffer): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;

  for (const cid of contractsByOwner(ctx.contractIndex, firmId)) {
    const contract = state.contracts[cid]!;
    if (!contract.active) continue;
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
      let best: { fac: import('../../entities/Facility').Facility; unit: number } | null = null;
      for (const fid in state.facilities) {
        const fac = state.facilities[fid]!;
        if (fac.ownerFirmId === firmId || fac.type === 'importer' || fac.status === 'closed') continue;
        // Warehouses are staging areas (often export stockpiles) — never
        // treat them as shops; and respect the owner's wholesale opt-out.
        if (fac.type === 'warehouse' || fac.wholesaleEnabled === false) continue;
        const sellerType = state.firms[fac.ownerFirmId]?.ownerType;
        if (sellerType !== 'ai' && sellerType !== 'player') continue;
        if (localSurplus(state, fac, pid, ctx.contractIndex) < LOCAL_SOURCE_MIN_SURPLUS) continue;
        const unit = wholesaleUnitPrice(state, fac, pid);
        if (unit >= importerUnit * LOCAL_SOURCE_SAVINGS) continue; // not enough savings
        if (!best || unit < best.unit) best = { fac, unit };
      }
      if (best) {
        contract.sourceFacilityId = best.fac.id;
        reindexContracts(ctx); // source key changed — rebucket before any later reader
        routeRoutine(state, digest, 'sourcing', firm.id,
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
      if (!cutOff && !gouged && (destHave > 0 || localSurplus(state, source, pid, ctx.contractIndex) >= 10)) {
        // Healthy relationship — but loyalty has a price. If a rival supplier
        // undercuts the current one by 10%+, take the better deal.
        for (const fid in state.facilities) {
          const fac = state.facilities[fid]!;
          if (fac.id === source.id || fac.ownerFirmId === firmId) continue;
          if (fac.type === 'importer' || fac.type === 'warehouse' || fac.status === 'closed') continue;
          if (fac.wholesaleEnabled === false) continue;
          const sellerType = state.firms[fac.ownerFirmId]?.ownerType;
          if (sellerType !== 'ai' && sellerType !== 'player') continue;
          if (localSurplus(state, fac, pid, ctx.contractIndex) < LOCAL_SOURCE_MIN_SURPLUS) continue;
          if (wholesaleUnitPrice(state, fac, pid) > curUnit * 0.9) continue;
          contract.sourceFacilityId = fac.id;
          reindexContracts(ctx); // source key changed — rebucket before any later reader
          routeRoutine(state, digest, 'sourcing', firm.id,
            `${firm.name} moved its ${getProduct(pid).name} order to ${state.firms[fac.ownerFirmId]!.name} — a sharper wholesale price.`,
            dest.id);
          return; // one switch per firm per day
        }
        continue;
      }
      const importer = Object.values(state.facilities).find((f) => f.type === 'importer');
      if (!importer) continue;
      contract.sourceFacilityId = importer.id;
      reindexContracts(ctx); // source key changed — rebucket before any later reader
      routeRoutine(state, digest, 'sourcing', firm.id,
        gouged && !cutOff
          ? `${firm.name} dropped ${state.firms[source.ownerFirmId]?.name ?? 'a supplier'} for ${getProduct(pid).name} — pricier than importing.`
          : `${firm.name} switched ${getProduct(pid).name} sourcing back to the importer — the local supplier ran dry.`,
        dest.id);
      return;
    }
  }
}

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
    for (const cid of contractsBySource(ctx.contractIndex, fac.id)) {
      const c = state.contracts[cid]!;
      if (!c.active) continue;
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

// ============================================================================
// The operator orchestrator — the per-firm daily loop body, verbatim.
// ============================================================================

/**
 * Run one 'operator' firm's full daily loop. This is the old AIStrategySystem
 * per-firm body moved verbatim: same behaviors, same order, same early-out on a
 * rescue acquisition (which changes the firm map — the old loop `continue`d past
 * the loss-streak update; here we `return` before it, identically). The
 * dispatcher calls this for every AI firm whose archetype is 'operator'.
 */
export function runOperatorBehavior(
  ctx: SimContext,
  firmId: string,
  digest: DigestBuffer | undefined,
): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.bankruptcyStatus !== 'insolvent') {
    manageWages(ctx, firm.id, digest);
    restaff(ctx, firm.id);
    maybeBoostProduction(ctx, firm.id);
    maybeWidenShelves(ctx, firm.id);
  }
  adjustPrices(ctx, firm.id, false, undefined, digest);
  if (firm.bankruptcyStatus === 'healthy') {
    managePositioning(ctx, firm.id);
    manageDebt(ctx, firm.id);
    manageSourcing(ctx, firm.id, digest);
    manageWholesalePricing(ctx, firm.id);
    manageAdBudget(ctx, firm.id);
    maybeInvestQuality(ctx, firm.id);
    maybeExpand(ctx, firm.id);
    maybeBuyShares(ctx, firm.id);
    maybeExportSurplus(ctx, firm.id);
    maybeUpgrade(ctx, firm.id);
    maybeBuildApartment(ctx, firm.id);
    maybeBuildDatacenter(ctx, firm.id);
    maybeEnterCoffee(ctx, firm.id);
    maybeEnterLuxury(ctx, firm.id);
    if (maybeRescueAcquisition(ctx, firm.id)) return; // firm map changed
  }

  // Track loss streak.
  const op = operatingProfit(firm.accounting.today);
  firm.strategy.lossStreak = op < 0 ? firm.strategy.lossStreak + 1 : 0;
}
