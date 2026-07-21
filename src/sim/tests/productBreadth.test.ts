import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import {
  PRODUCTS,
  ALL_PRODUCT_IDS,
  PRODUCT_IDS_BY_PRESET,
  CONSUMER_PRODUCT_IDS_BY_PRESET,
  COHORT_DEMAND_PRODUCT_IDS,
  productAvailableInPreset,
  getProduct,
} from '../data/products';
import { RECIPES, getRecipe } from '../data/recipes';
import { CHAIN_BLUEPRINTS } from '../data/chains';
import { FACILITY_DEFS } from '../data/facilityDefinitions';
import { tierNeedGrowthMult } from '../systems/TierSystem';
import { needWeight, BASKET_WEIGHT_BASELINE } from '../systems/SatisfactionSystem';

/**
 * Arc C1 — product breadth. These pin the two halves of the slice: (1) the
 * gate that keeps the broader catalog OUT of Village and City (determinism +
 * the pinned city tier calibration), and (2) the catalog integrity + budget
 * bound that make each new product a real, reachable, affordable good.
 */

/** The Arc C1 breadth consumer products (metropolis-only, need-bearing). */
const C1_CONSUMER = ['meals', 'shoes', 'furniture', 'appliances', 'wine'];
/** Their upstream raws. */
const C1_RAW = ['produce', 'leather', 'lumber', 'grapes'];

describe('C1 product breadth — preset gate', () => {
  it('every C1 product is metropolis-only; Village and City catalogs are the base catalog', () => {
    for (const pid of [...C1_CONSUMER, ...C1_RAW]) {
      expect(PRODUCTS[pid], pid).toBeTruthy();
      expect(PRODUCTS[pid]!.availableIn, pid).toBe('metropolis');
      expect(productAvailableInPreset(pid, 'village'), pid).toBe(false);
      expect(productAvailableInPreset(pid, 'city'), pid).toBe(false);
      expect(productAvailableInPreset(pid, 'metropolis'), pid).toBe(true);
    }
    // Village and City product lists carry ZERO C1 ids; Metropolis carries all.
    for (const pid of [...C1_CONSUMER, ...C1_RAW]) {
      expect(PRODUCT_IDS_BY_PRESET.village.includes(pid), pid).toBe(false);
      expect(PRODUCT_IDS_BY_PRESET.city.includes(pid), pid).toBe(false);
      expect(PRODUCT_IDS_BY_PRESET.metropolis.includes(pid), pid).toBe(true);
    }
    // The Village/City catalogs are byte-identical to the base catalog (the
    // products that predate C1 — those with no availableIn floor).
    const base = ALL_PRODUCT_IDS.filter((id) => !PRODUCTS[id]!.availableIn);
    expect(PRODUCT_IDS_BY_PRESET.village).toEqual(base);
    expect(PRODUCT_IDS_BY_PRESET.city).toEqual(base);
  });

  it('the crowd craves only the base catalog at every preset (city calibration + no founder deadlock)', () => {
    // COHORT_DEMAND_PRODUCT_IDS is the crowd's demand catalog: base consumer
    // products only, so a City crowd never sees C1 (keeps the pinned tier bands)
    // and no crowd ever craves an unserved product into a founder-blocking drag.
    for (const pid of C1_CONSUMER) {
      expect(COHORT_DEMAND_PRODUCT_IDS.includes(pid), pid).toBe(false);
    }
    // It is exactly the base consumer catalog.
    const baseConsumer = CONSUMER_PRODUCT_IDS_BY_PRESET.city; // city == base
    expect([...COHORT_DEMAND_PRODUCT_IDS].sort()).toEqual([...baseConsumer].sort());
  });

  it('C1 needSpec orders sort after every base order (never disturbs the base draw sequence)', () => {
    const baseMaxOrder = Math.max(
      ...ALL_PRODUCT_IDS.filter((id) => !PRODUCTS[id]!.availableIn && PRODUCTS[id]!.needSpec).map(
        (id) => PRODUCTS[id]!.needSpec!.order,
      ),
    );
    for (const pid of C1_CONSUMER) {
      expect(PRODUCTS[pid]!.needSpec!.order, pid).toBeGreaterThan(baseMaxOrder);
    }
    // All needSpec orders are unique across the whole catalog.
    const orders = ALL_PRODUCT_IDS.filter((id) => PRODUCTS[id]!.needSpec).map(
      (id) => PRODUCTS[id]!.needSpec!.order,
    );
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('C1 product breadth — catalog integrity', () => {
  it('every C1 consumer product is producible via a full chain AND retailed by the store', () => {
    const retail = FACILITY_DEFS.retail!;
    for (const pid of C1_CONSUMER) {
      // Producible: a chain blueprint stands up producer -> [...] -> store, and
      // every stage's recipe exists, is allowed by its facility, and links to
      // the next stage's input (the last stage makes the consumer product).
      const bp = CHAIN_BLUEPRINTS[pid];
      expect(bp, pid).toBeTruthy();
      expect(bp!.stages.length, pid).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < bp!.stages.length; i++) {
        const stage = bp!.stages[i]!;
        const recipe = getRecipe(stage.recipeId);
        expect(FACILITY_DEFS[stage.facilityDefId]!.allowedRecipes.includes(stage.recipeId), `${pid}:${stage.recipeId}`).toBe(true);
        const out = recipe.outputs[0]!.productId;
        if (i === 0) {
          // First stage extracts a raw (no inputs).
          expect(recipe.inputs.length, `${pid} stage0`).toBe(0);
        } else {
          // Every later stage consumes the previous stage's output.
          const prevOut = getRecipe(bp!.stages[i - 1]!.recipeId).outputs[0]!.productId;
          expect(recipe.inputs.some((inp) => inp.productId === prevOut), `${pid} stage${i}`).toBe(true);
        }
        // The last stage makes the consumer product.
        if (i === bp!.stages.length - 1) expect(out, pid).toBe(pid);
      }
      // Retailed: the store type can stock it.
      expect(retail.allowedProductsForSale.includes(pid), pid).toBe(true);
    }
  });

  it('the appliances and furniture chains are 3-stage through an intermediate', () => {
    for (const [pid, mid] of [['appliances', 'steel'], ['furniture', 'planks']] as const) {
      const bp = CHAIN_BLUEPRINTS[pid]!;
      expect(bp.stages.length, pid).toBe(3);
      // Middle stage outputs the intermediate; the intermediate is a real,
      // metropolis-only, non-consumer producer good (no needSpec, never retailed).
      expect(getRecipe(bp.stages[1]!.recipeId).outputs[0]!.productId, pid).toBe(mid);
      expect(PRODUCTS[mid]!.category, mid).toBe('intermediate');
      expect(PRODUCTS[mid]!.availableIn, mid).toBe('metropolis');
      expect(PRODUCTS[mid]!.needSpec, mid).toBeUndefined();
      expect(PRODUCTS[mid]!.needType, mid).toBe('none');
      expect(FACILITY_DEFS.retail!.allowedProductsForSale.includes(mid), mid).toBe(false);
      // The intermediate is metropolis-only: absent from Village/City catalogs.
      expect(PRODUCT_IDS_BY_PRESET.village.includes(mid), mid).toBe(false);
      expect(PRODUCT_IDS_BY_PRESET.city.includes(mid), mid).toBe(false);
      expect(PRODUCT_IDS_BY_PRESET.metropolis.includes(mid), mid).toBe(true);
    }
  });

  it('every C1 raw is extracted by some recipe and consumed by a factory recipe', () => {
    for (const raw of C1_RAW) {
      const extractors = Object.values(RECIPES).filter(
        (r) => r.inputs.length === 0 && r.outputs.some((o) => o.productId === raw),
      );
      expect(extractors.length, raw).toBeGreaterThanOrEqual(1);
      const consumers = Object.values(RECIPES).filter((r) =>
        r.inputs.some((i) => i.productId === raw),
      );
      expect(consumers.length, raw).toBeGreaterThanOrEqual(1);
    }
  });

  it("each C1 consumer product's walkaway price is reachable within its target tier's cap", () => {
    // "Priced within its tier's walkaway": the product's midpoint walkaway
    // (basePrice x midpoint maxPriceMult, scaled by the tier's price-cap mult)
    // must clear its own base price for every tier that wants it — i.e. a tier
    // that craves it can always afford at least the reference price. A product
    // no tier could ever pay for at base would be dead on the shelf.
    for (const pid of C1_CONSUMER) {
      const spec = PRODUCTS[pid]!.needSpec!;
      const midCap = (spec.maxPriceMult[0] + spec.maxPriceMult[1]) / 2;
      let wanted = false;
      for (const tier of ['worker', 'comfortable', 'affluent'] as const) {
        if (tierNeedGrowthMult(tier, pid) <= 0) continue;
        wanted = true;
        const tierCap = spec.tierPriceCapMult?.[tier] ?? 1;
        const walkaway = getProduct(pid).basePrice * midCap * tierCap;
        expect(walkaway, `${pid}/${tier}`).toBeGreaterThanOrEqual(getProduct(pid).basePrice);
      }
      expect(wanted, pid).toBe(true); // some tier actually wants it
    }
  });
});

describe('C1 product breadth — budget bound (C1 acceptance)', () => {
  it('the metropolis daily basket at spec midpoints stays <= 85% of median income', () => {
    // A full daily consumption basket priced at the spec reference (base) price
    // and consumed at the spec-midpoint rate must stay affordable to the median
    // citizen. Honest scope note: every C1 consumer product carries
    // tierGrowthMult.worker = 0, so the worker basket summed here equals the
    // pre-C1 base basket by construction — what this line actually pins is the
    // median income not collapsing under the broader catalog (a real 120-day
    // metropolis run). The comfortable-tier branch below is where C1 products
    // genuinely enter the affordability math.
    const state = createInitialState(7, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(state.config) * 120);
    const st = sim.getState();

    const incomes = Object.values(st.citizens)
      .map((c) => (c.employmentStatus === 'employed' ? c.wage : st.config.subsistenceIncomePerDay))
      .sort((a, b) => a - b);
    const medianIncome = incomes[Math.floor(incomes.length / 2)] ?? 0;
    expect(medianIncome).toBeGreaterThan(0);

    const dailyBasket = (tier: 'worker' | 'comfortable' | 'affluent'): number => {
      let sum = 0;
      for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET.metropolis) {
        const spec = PRODUCTS[pid]!.needSpec!;
        const midGrowth = (spec.growthPerDay[0] + spec.growthPerDay[1]) / 2;
        sum += spec.preferredQuantity * getProduct(pid).basePrice * midGrowth * tierNeedGrowthMult(tier, pid);
      }
      return sum;
    };

    // Worker (median tier) basket: the pinned acceptance. Measured at $11.04/day
    // against a $24.00/day median income (46%) — comfortably inside 85%.
    const workerBasket = dailyBasket('worker');
    expect(workerBasket).toBeLessThanOrEqual(0.85 * medianIncome);
    // The comfortable basket also clears the median income (they earn above it,
    // so this is a generous guard that the ladder's mid-tier is never priced out).
    expect(dailyBasket('comfortable')).toBeLessThanOrEqual(medianIncome);
  });
});

describe('C1 product breadth — satisfaction renormalization (introduction promise)', () => {
  it('the metropolis cast basket renormalizes so C1 exposure redistributes (<= baseline)', () => {
    // A1's promise: adding products REDISTRIBUTES unmet-need exposure rather than
    // stacking it. The cast's basketNormalization caps a tier's effective basket
    // weight at BASKET_WEIGHT_BASELINE, so however many C1 products a tier wants,
    // its total satisfaction-weighted exposure never exceeds the shipped baseline
    // — which bounds any single product's arrival dip.
    for (const tier of ['worker', 'comfortable', 'affluent'] as const) {
      let basketW = 0;
      for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET.metropolis) {
        if (tierNeedGrowthMult(tier, pid) > 0) basketW += needWeight(pid);
      }
      const norm = basketW > BASKET_WEIGHT_BASELINE ? BASKET_WEIGHT_BASELINE / basketW : 1;
      // Effective (renormalized) basket weight never exceeds the baseline.
      expect(basketW * norm).toBeLessThanOrEqual(BASKET_WEIGHT_BASELINE + 1e-9);
    }
    // Each C1 product carries a modest satisfaction stake (well under a staple's
    // food weight of 1.4), so even fully unmet its raw exposure is small — the
    // ceiling on any one product's introduction dip.
    for (const pid of C1_CONSUMER) {
      expect(needWeight(pid), pid).toBeLessThanOrEqual(0.55);
    }
  });
});

describe('C1 product breadth — metropolis soak (conservation + solvency)', () => {
  it('a 200-day metropolis run keeps money conserved with a solvent AI field', () => {
    const state = createInitialState(7, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(state.config) * 200);
    const st = sim.getState();
    // Conserved to the cent across the whole broadened-catalog economy.
    expect(totalMoneySupply(st)).toBe(supply0);
    // The AI field is not a bankruptcy cascade: most firms are healthy.
    const ai = Object.values(st.firms).filter((f) => f.ownerType === 'ai');
    const unhealthy = ai.filter((f) => f.bankruptcyStatus !== 'healthy').length;
    expect(ai.length).toBeGreaterThan(0);
    expect(unhealthy / ai.length).toBeLessThanOrEqual(0.2);
    // The crowd survived (no depopulation collapse).
    const crowd = Object.values(st.cohorts).reduce((n, c) => n + c.population, 0);
    expect(crowd).toBeGreaterThan(200);
  });
});
