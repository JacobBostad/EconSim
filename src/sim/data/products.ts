/**
 * products.ts — Product catalog (data-driven).
 *
 * To add a product: append a Product here — with a `needSpec` if citizens
 * should want it — add a recipe in recipes.ts, and reference it from a
 * facility definition (factory allowedRecipes + retail allowedProductsForSale).
 * Demand, tier appetite, and save migration all derive from the needSpec;
 * nothing else in the engine needs to change.
 *
 * Chains shipped:
 *   grain  -> bread  (food, sold to citizens)
 *   minerals -> tools (durable, sold to citizens)
 *   cotton -> clothes (apparel, sold to citizens)
 */

import type { Product } from '../entities/Product';
import type { ProductId } from '../core/Id';
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
