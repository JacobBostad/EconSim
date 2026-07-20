/**
 * products.ts — Product catalog (data-driven).
 *
 * To add a product: append a Product here — with a `needSpec` if citizens
 * should want it — add a recipe in recipes.ts, and reference it from a
 * facility definition (factory allowedRecipes + retail allowedProductsForSale).
 * Demand, tier appetite, and save migration all derive from the needSpec;
 * nothing else in the engine needs to change.
 *
 * Chains shipped (Village catalog — present at every preset):
 *   grain  -> bread  (food, sold to citizens)
 *   minerals -> tools (durable, sold to citizens)
 *   cotton -> clothes (apparel, sold to citizens)
 *   grain -> coffee (food ritual); grain -> pastries, minerals -> jewelry (luxury)
 *
 * Arc C1 breadth (availableIn: 'metropolis' — METROPOLIS ONLY):
 *   produce -> meals     (food, a prepared-meal staple)
 *   leather -> shoes     (apparel)
 *   lumber  -> furniture (durable, comfortable+)
 *   minerals -> appliances (durable, comfortable+)
 *   grapes  -> wine      (luxury, comfortable+)
 * These carry an `availableIn: 'metropolis'` floor and sort AFTER every Village
 * needSpec `order`, so the Village demand loop, trade-city rng walk, founder
 * scan, and serialized state stay byte-identical (see productIdsForPreset).
 *
 * Why metropolis-only, not city: the CITY preset carries a knife-edge,
 * seed-pinned A3/A4 tier-band calibration (see tierAcceptance) with near-zero
 * headroom. Adding these products to the city desynced its pinned rng
 * trajectory (the broader trade-city price walk and citizen creation draw extra
 * rng) and shifted its crowd tier bands out of band. Metropolis has no pinned
 * tier-band test, so it carries the breadth; the crowd (cohorts) still shops the
 * base catalog at every preset (COHORT_DEMAND_PRODUCT_IDS) and the C1 products'
 * citizen demand comes from the named cast, which shops with the A1-renormalized
 * per-need trips. Village is untouched at every layer.
 */

import type { Product } from '../entities/Product';
import type { ProductId } from '../core/Id';
import type { SizePreset } from '../core/SimulationConfig';
import { dollars } from './constants';

export const PRODUCTS: Record<ProductId, Product> = {
  grain: {
    id: 'grain',
    name: 'Grain',
    category: 'raw',
    basePrice: dollars(1.5),
    perishability: 0.05,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 1,
  },
  bread: {
    id: 'bread',
    name: 'Bread',
    category: 'food',
    basePrice: dollars(3.5),
    perishability: 0.08,
    qualityWeight: 0.15,
    priceWeight: 0.25,
    brandWeight: 0.1,
    needType: 'food',
    defaultQuality: 60,
    unitSize: 1,
    needSpec: {
      order: 1,
      urgency0: [0.2, 0.9],
      growthPerDay: [0.55, 0.75],
      preferredQuantity: 2,
      maxPriceMult: [1.4, 1.8],
      migration: { urgency: 0.55, growthPerDay: 0.65, maxPriceMult: 1.6 },
      tierPriceCapMult: { affluent: 1.1 },
    },
  },
  minerals: {
    id: 'minerals',
    name: 'Minerals',
    category: 'raw',
    basePrice: dollars(2.0),
    perishability: 0,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 1,
  },
  tools: {
    id: 'tools',
    name: 'Tools',
    category: 'durable',
    basePrice: dollars(9.0),
    perishability: 0,
    qualityWeight: 0.2,
    priceWeight: 0.2,
    brandWeight: 0.15,
    needType: 'goods',
    defaultQuality: 65,
    unitSize: 2,
    needSpec: {
      // Durables are wanted every ~4 days; keep demand near what the
      // town's production capacity can actually satisfy (see balance notes).
      order: 2,
      urgency0: [0, 0.4],
      growthPerDay: [0.22, 0.32],
      preferredQuantity: 1,
      maxPriceMult: [1.3, 1.6],
      migration: { urgency: 0.2, growthPerDay: 0.27, maxPriceMult: 1.45 },
    },
  },
  cotton: {
    id: 'cotton',
    name: 'Cotton',
    category: 'raw',
    basePrice: dollars(2.2),
    perishability: 0.02,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 1,
  },
  clothes: {
    id: 'clothes',
    name: 'Clothes',
    category: 'apparel',
    basePrice: dollars(12.0),
    perishability: 0,
    qualityWeight: 0.22,
    priceWeight: 0.18,
    brandWeight: 0.2,
    needType: 'clothing',
    defaultQuality: 60,
    unitSize: 2,
    needSpec: {
      order: 4,
      urgency0: [0, 0.5],
      growthPerDay: [0.2, 0.3],
      preferredQuantity: 1,
      maxPriceMult: [1.35, 1.65],
      migration: { urgency: 0.25, growthPerDay: 0.21, maxPriceMult: 1.5 },
      tierGrowthMult: { affluent: 1.4 },
      tierPriceCapMult: { affluent: 1.2 },
    },
  },
  coffee: {
    id: 'coffee',
    name: 'Coffee',
    category: 'food',
    basePrice: dollars(2.5),
    perishability: 0.06,
    qualityWeight: 0.18,
    priceWeight: 0.2,
    brandWeight: 0.15,
    needType: 'goods',
    // A missed morning coffee is a grumble, not a crisis — without this the
    // pre-coffee-vendor town (nobody sells it at start) takes a big
    // satisfaction hit for a product that didn't exist yesterday.
    satisfactionWeight: 0.3,
    defaultQuality: 60,
    unitSize: 1,
    needSpec: {
      // A cheap daily ritual: small ticket, high frequency — the demand sink
      // that soaks up idle citizen cash. One cup a day (~20% of a base
      // wage): a habit, not a wallet drain — at 2 cups/day coffee ate ~44%
      // of income and starved staple demand.
      order: 3,
      urgency0: [0.1, 0.6],
      growthPerDay: [0.35, 0.5],
      preferredQuantity: 1,
      maxPriceMult: [1.5, 1.9],
      migration: { urgency: 0.3, growthPerDay: 0.42, maxPriceMult: 1.7 },
      tierGrowthMult: { affluent: 1.5 },
      tierPriceCapMult: { affluent: 1.2 },
    },
  },
  pastries: {
    id: 'pastries',
    name: 'Pastries',
    category: 'luxury',
    basePrice: dollars(8.0),
    perishability: 0.1,
    qualityWeight: 0.3,
    priceWeight: 0.1,
    brandWeight: 0.25,
    needType: 'luxury',
    defaultQuality: 70,
    unitSize: 1,
    needSpec: {
      // Luxury cravings start at exactly zero (no draw) and only grow for
      // citizens whose tier wants them.
      order: 5,
      urgency0: 0,
      growthPerDay: [0.1, 0.18],
      preferredQuantity: 1,
      maxPriceMult: [1.2, 1.6],
      migration: { urgency: 0, growthPerDay: 0.14, maxPriceMult: 1.4 },
      tierGrowthMult: { worker: 0, comfortable: 0.5, affluent: 1.5 },
    },
  },
  jewelry: {
    id: 'jewelry',
    name: 'Jewelry',
    category: 'luxury',
    basePrice: dollars(30.0),
    perishability: 0,
    qualityWeight: 0.32,
    priceWeight: 0.08,
    brandWeight: 0.3,
    needType: 'luxury',
    defaultQuality: 70,
    unitSize: 1,
    needSpec: {
      order: 6,
      urgency0: 0,
      growthPerDay: [0.03, 0.07],
      preferredQuantity: 1,
      maxPriceMult: [1.1, 1.4],
      migration: { urgency: 0, growthPerDay: 0.05, maxPriceMult: 1.25 },
      tierGrowthMult: { worker: 0, comfortable: 0.3, affluent: 1.5 },
    },
  },

  // ===================================================================
  // Arc C1 — metropolis breadth. Every product below carries
  // `availableIn: 'metropolis'` and a needSpec `order` above the Village max
  // (6), so productIdsForPreset filters them out of the Village AND City
  // catalogs entirely (see the file header for why metropolis-only).
  // ===================================================================

  // --- Meals chain (produce -> meals): prepared food, comfortable+ demand ---
  produce: {
    id: 'produce',
    name: 'Produce',
    category: 'raw',
    basePrice: dollars(1.8),
    perishability: 0.12,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 1,
    availableIn: 'metropolis',
  },
  meals: {
    id: 'meals',
    name: 'Meals',
    category: 'food',
    basePrice: dollars(5.5),
    perishability: 0.14,
    qualityWeight: 0.2,
    priceWeight: 0.22,
    brandWeight: 0.12,
    needType: 'food',
    // A prepared meal is a convenience on top of home staples, not the daily
    // hunger backstop bread is — a light satisfaction stake (well under bread's
    // 1.4) so an under-served meals market neither drags the town's happiness
    // nor pulls shopping trips away from the real staples.
    satisfactionWeight: 0.35,
    defaultQuality: 62,
    unitSize: 1,
    availableIn: 'metropolis',
    needSpec: {
      // Sorts after every Village order (max 6). Moderate ticket, moderate
      // frequency — a comfortable+ good: worker mult is 0 below, which is what
      // keeps the pinned worker-affordability/budget numbers valid.
      order: 7,
      urgency0: [0, 0.3],
      growthPerDay: [0.05, 0.09],
      preferredQuantity: 1,
      maxPriceMult: [1.3, 1.6],
      migration: { urgency: 0.15, growthPerDay: 0.07, maxPriceMult: 1.45 },
      // Worker appetite kept light: a prepared meal is an occasional convenience
      // on top of home cooking, so it never drains the worker savings margin that
      // gates promotion (the city tier bands are calibrated on that margin).
      tierGrowthMult: { worker: 0, comfortable: 1, affluent: 1.3 },
      tierPriceCapMult: { affluent: 1.15 },
    },
  },

  // --- Shoes chain (leather -> shoes): apparel, wears slowly -------------
  leather: {
    id: 'leather',
    name: 'Leather',
    category: 'raw',
    basePrice: dollars(2.6),
    perishability: 0.01,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 1,
    availableIn: 'metropolis',
  },
  shoes: {
    id: 'shoes',
    name: 'Shoes',
    category: 'apparel',
    basePrice: dollars(11.0),
    perishability: 0,
    qualityWeight: 0.22,
    priceWeight: 0.2,
    brandWeight: 0.2,
    needType: 'clothing',
    // A worn-in pair still works: a light satisfaction stake so a thin shoe
    // market doesn't drag happiness or steal trips from clothing/food.
    satisfactionWeight: 0.3,
    defaultQuality: 60,
    unitSize: 1,
    availableIn: 'metropolis',
    needSpec: {
      // A slow-wear staple: everyone needs a pair, replaced rarely — a low
      // daily basket cost the affluent replace a touch more often (fashion).
      order: 8,
      urgency0: [0, 0.3],
      growthPerDay: [0.03, 0.06],
      preferredQuantity: 1,
      maxPriceMult: [1.3, 1.6],
      migration: { urgency: 0.15, growthPerDay: 0.045, maxPriceMult: 1.45 },
      // Slow-wear, comfortable+ only (worker mult 0 — protects the pinned
      // worker budget); the affluent refresh more.
      tierGrowthMult: { worker: 0, comfortable: 1, affluent: 1.3 },
      tierPriceCapMult: { affluent: 1.2 },
    },
  },

  // --- Furniture chain (lumber -> furniture): comfortable+ durable -------
  lumber: {
    id: 'lumber',
    name: 'Lumber',
    category: 'raw',
    basePrice: dollars(2.2),
    perishability: 0,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 2,
    availableIn: 'metropolis',
  },
  furniture: {
    id: 'furniture',
    name: 'Furniture',
    category: 'durable',
    basePrice: dollars(26.0),
    perishability: 0,
    qualityWeight: 0.24,
    priceWeight: 0.16,
    brandWeight: 0.2,
    needType: 'goods',
    // You already have a table: a missing upgrade is a mild want, not a crisis
    // — a very light stake keeps an under-served furniture market from dragging
    // the comfortable tier's happiness below its retention/promotion floor.
    satisfactionWeight: 0.15,
    defaultQuality: 64,
    unitSize: 3,
    availableIn: 'metropolis',
    needSpec: {
      // A big-ticket durable the comfortable furnish their homes with; workers
      // buy sparingly (mult 0.3), the affluent kit out larger homes.
      order: 9,
      urgency0: 0,
      growthPerDay: [0.04, 0.07],
      preferredQuantity: 1,
      maxPriceMult: [1.25, 1.55],
      migration: { urgency: 0, growthPerDay: 0.055, maxPriceMult: 1.4 },
      // Comfortable+ only (worker mult 0): a big-ticket durable outside the
      // worker budget, so it enriches the comfortable/affluent tiers without
      // taxing the worker savings margin.
      tierGrowthMult: { worker: 0, comfortable: 1, affluent: 1.4 },
      tierPriceCapMult: { comfortable: 1.1, affluent: 1.25 },
    },
  },

  // --- Appliances chain (minerals -> appliances): comfortable+ durable ---
  appliances: {
    id: 'appliances',
    name: 'Appliances',
    category: 'durable',
    basePrice: dollars(42.0),
    perishability: 0,
    qualityWeight: 0.26,
    priceWeight: 0.18,
    brandWeight: 0.22,
    needType: 'goods',
    // An aspirational durable: a very light satisfaction stake (an unmet
    // appliance want barely registers next to food), so a thin appliance market
    // never taxes the comfortable tier's happiness.
    satisfactionWeight: 0.15,
    defaultQuality: 66,
    unitSize: 3,
    availableIn: 'metropolis',
    needSpec: {
      // The priciest durable — a comfortable-and-up want that starts at exactly
      // 0 (no rng draw) and only grows for tiers that reach for it.
      order: 10,
      urgency0: 0,
      growthPerDay: [0.03, 0.06],
      preferredQuantity: 1,
      maxPriceMult: [1.2, 1.5],
      migration: { urgency: 0, growthPerDay: 0.045, maxPriceMult: 1.35 },
      // Comfortable+ only (worker mult 0): the priciest durable, an aspirational
      // want the ladder unlocks — never a drag on the worker economy.
      tierGrowthMult: { worker: 0, comfortable: 1, affluent: 1.4 },
      tierPriceCapMult: { comfortable: 1.1, affluent: 1.3 },
    },
  },

  // --- Wine chain (grapes -> wine): comfortable+ luxury ------------------
  grapes: {
    id: 'grapes',
    name: 'Grapes',
    category: 'raw',
    basePrice: dollars(2.0),
    perishability: 0.1,
    qualityWeight: 0,
    priceWeight: 0,
    brandWeight: 0,
    needType: 'none',
    defaultQuality: 50,
    unitSize: 1,
    availableIn: 'metropolis',
  },
  wine: {
    id: 'wine',
    name: 'Wine',
    category: 'luxury',
    basePrice: dollars(15.0),
    perishability: 0,
    qualityWeight: 0.3,
    priceWeight: 0.12,
    brandWeight: 0.26,
    needType: 'luxury',
    defaultQuality: 68,
    unitSize: 1,
    availableIn: 'metropolis',
    needSpec: {
      // Comfortable+ luxury: the ladder gates it (worker mult 0), but it sits
      // a rung below jewelry/pastries — the comfortable indulge it, keeping the
      // affluent-only luxury (jewelry) genuinely thin.
      order: 11,
      urgency0: 0,
      growthPerDay: [0.04, 0.08],
      preferredQuantity: 1,
      maxPriceMult: [1.2, 1.5],
      migration: { urgency: 0, growthPerDay: 0.06, maxPriceMult: 1.35 },
      tierGrowthMult: { worker: 0, comfortable: 1, affluent: 1.5 },
      tierPriceCapMult: { comfortable: 1.1, affluent: 1.3 },
    },
  },
};

export function getProduct(id: ProductId): Product {
  const p = PRODUCTS[id];
  if (!p) throw new Error(`Unknown product: ${id}`);
  return p;
}

export const ALL_PRODUCT_IDS: ProductId[] = Object.keys(PRODUCTS);

/** Products that satisfy a citizen need (i.e. are sold at retail). */
export const CONSUMER_PRODUCT_IDS: ProductId[] = ALL_PRODUCT_IDS.filter(
  (id) => PRODUCTS[id]!.needType !== 'none',
);

// ---------------------------------------------------------------------------
// Preset gating (Arc C1). A product's `availableIn` names the LOWEST preset it
// exists at; ranked village < city < metropolis. Every Village-active system
// that iterates a product list — the citizen-need/preference draws, the
// trade-city rng walk, market-stat seeding, the founder scan, save-migration
// backfill, and the UI selectors — reads the PRESET-FILTERED list below rather
// than the raw catalog. At Village the filtered lists are byte-identical to the
// pre-C1 catalog (same members, same order), so the seeded draw sequence and
// the serialized state never move; the broader catalog only materializes at
// City/Metropolis. New products append after the Village entries, so the
// Village slice keeps its historical iteration order exactly.
// ---------------------------------------------------------------------------

const PRESET_RANK: Record<SizePreset, number> = { village: 0, city: 1, metropolis: 2 };

/** True if `id` exists at `preset` (its availableIn floor is at or below it). */
export function productAvailableInPreset(id: ProductId, preset: SizePreset): boolean {
  const floor = PRODUCTS[id]!.availableIn ?? 'village';
  return PRESET_RANK[preset] >= PRESET_RANK[floor];
}

function idsForPreset(preset: SizePreset, source: ProductId[]): ProductId[] {
  return source.filter((id) => productAvailableInPreset(id, preset));
}

/** All product ids present at a preset, in catalog order. Precomputed per
 * preset (the catalog is static) so hot per-tick systems index a frozen array
 * with no allocation. */
export const PRODUCT_IDS_BY_PRESET: Record<SizePreset, ProductId[]> = {
  village: idsForPreset('village', ALL_PRODUCT_IDS),
  city: idsForPreset('city', ALL_PRODUCT_IDS),
  metropolis: idsForPreset('metropolis', ALL_PRODUCT_IDS),
};

/**
 * Consumer (need-bearing) product ids present at a preset, in catalog order.
 * This is also the CROWD's demand catalog (district × tier cohorts crave the
 * consumer products present at their town's preset — see CohortDemandSystem /
 * Cohort.seedNeedBuckets). Because the Arc C1 breadth is metropolis-only, the
 * `city` entry is exactly the base consumer catalog: the crowd of a City never
 * sees the C1 products, which is what keeps the pinned A3/A4 city tier
 * calibration byte-stable. The Metropolis entry adds the C1 breadth, so a
 * Metropolis crowd shops the full catalog and its founders answer C1 shortages.
 * (Why metropolis-only and not city: the city preset carries a knife-edge,
 * seed-pinned tier-band calibration — feeding any extra demand into the crowd's
 * diluting softmax shifted it out of band, and the extra rng draws from the
 * broader trade-city price walk / citizen creation desynced the pinned
 * trajectory outright. Metropolis has no pinned tier-band test, so it carries
 * the breadth.)
 */
export const CONSUMER_PRODUCT_IDS_BY_PRESET: Record<SizePreset, ProductId[]> = {
  village: idsForPreset('village', CONSUMER_PRODUCT_IDS),
  city: idsForPreset('city', CONSUMER_PRODUCT_IDS),
  metropolis: idsForPreset('metropolis', CONSUMER_PRODUCT_IDS),
};

/**
 * The abstract CROWD's demand catalog: the base consumer catalog only (needSpec,
 * no `availableIn` floor). The crowd (district × tier cohorts) sticks to the
 * classic catalog at every preset — the Arc C1 breadth is cast/player/founder
 * territory. Two reasons: (1) the crowd's satisfaction/tier gates are a pinned
 * A3/A4 calibration with near-zero headroom, and feeding extra demand through
 * the crowd's diluting softmax shifts it; (2) a crowd craving an as-yet-unserved
 * product only drags town satisfaction below the founder's entry gate, blocking
 * the very founding that would serve it. Holding the crowd to the base catalog
 * keeps the calibration byte-stable AND lets founders answer C1 shortages off
 * the named cast's demand (whose satisfaction carries the A1 renormalization).
 */
export const COHORT_DEMAND_PRODUCT_IDS: ProductId[] = CONSUMER_PRODUCT_IDS.filter(
  (id) => !PRODUCTS[id]!.availableIn,
);
