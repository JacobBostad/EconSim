/**
 * products.ts — Product catalog (data-driven).
 *
 * To add a product: append a Product here and (if it can be produced) add a
 * recipe in recipes.ts and reference it from a facility definition. Nothing
 * else in the engine needs to change.
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
