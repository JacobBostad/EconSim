/**
 * Product.ts — Product definition type.
 *
 * Products are static, data-driven definitions (see /data/products.ts). They are
 * referenced everywhere by `ProductId`. All prices are expressed in integer
 * cents to keep money arithmetic exact and conservation invariants clean.
 */

import type { ProductId } from '../core/Id';
import type { CitizenTier } from './Citizen';

export type ProductCategory = 'food' | 'durable' | 'raw' | 'intermediate' | 'apparel' | 'luxury';

/** What kind of citizen need this product satisfies (raw goods satisfy none). */
export type NeedType = 'food' | 'goods' | 'clothing' | 'luxury' | 'none';

/**
 * How citizens come to WANT this product — the demand side as data. A product
 * with a needSpec generates a recurring citizen need at creation; one without
 * (raw goods, intermediates, B2B services) generates none. Adding a consumer
 * product is now genuinely "add it here and give it a recipe".
 */
export interface NeedSpec {
  /**
   * Rng draw order at citizen creation. Pinned explicitly — NOT catalog
   * order — so adding products never shifts the seeded draw sequence that
   * every probe baseline and golden save depends on.
   */
  order: number;
  /** Initial urgency [min,max] drawn from the stream; a plain number is a
   * fixed value that consumes NO draw (luxury cravings start at exactly 0). */
  urgency0: [number, number] | number;
  growthPerDay: [number, number];
  preferredQuantity: number;
  /** Walkaway price cap [min,max] × base price. */
  maxPriceMult: [number, number];
  /** Deterministic values used when backfilling saves that predate the
   * product (no rng in migrations). Hand-pinned, not computed — the shipped
   * products' values are byte-compatible with the old hand-authored table. */
  migration: { urgency: number; growthPerDay: number; maxPriceMult: number };
  /** Prosperity-ladder appetite scaling (default 1; 0 = tier never wants it). */
  tierGrowthMult?: Partial<Record<CitizenTier, number>>;
  /** Prosperity-ladder walkaway-cap scaling (default 1). */
  tierPriceCapMult?: Partial<Record<CitizenTier, number>>;
}

export interface Product {
  id: ProductId;
  name: string;
  category: ProductCategory;
  /** Reference base price in cents. Used as the market reference for scoring. */
  basePrice: number;
  /** 0 = never spoils, 1 = spoils fast. Used by InventorySystem for perishables. */
  perishability: number;
  /** Weighting of quality when citizens score a store (0..1). */
  qualityWeight: number;
  /** Weighting of price when citizens score a store (0..1). */
  priceWeight: number;
  /** Weighting of brand/reliability when citizens score a store (0..1). */
  brandWeight: number;
  /** Which citizen need this product satisfies. */
  needType: NeedType;
  /**
   * Override for how much an unmet need for this product hurts satisfaction
   * (defaults per needType: food 1.4, luxury 0.2, else 0.55). Lets a small
   * craving (coffee) matter less than a missing staple at the same needType.
   */
  satisfactionWeight?: number;
  /** Default quality (0..100) for freshly produced units. */
  defaultQuality: number;
  /** Logical size per unit (used for storage/transport accounting). */
  unitSize: number;
  /** Demand generation (consumer products only — see NeedSpec). */
  needSpec?: NeedSpec;
}
