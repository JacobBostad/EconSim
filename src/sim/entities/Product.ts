/**
 * Product.ts — Product definition type.
 *
 * Products are static, data-driven definitions (see /data/products.ts). They are
 * referenced everywhere by `ProductId`. All prices are expressed in integer
 * cents to keep money arithmetic exact and conservation invariants clean.
 */

import type { ProductId } from '../core/Id';

export type ProductCategory = 'food' | 'durable' | 'raw' | 'intermediate' | 'apparel' | 'luxury';

/** What kind of citizen need this product satisfies (raw goods satisfy none). */
export type NeedType = 'food' | 'goods' | 'clothing' | 'luxury' | 'none';

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
  /** Default quality (0..100) for freshly produced units. */
  defaultQuality: number;
  /** Logical size per unit (used for storage/transport accounting). */
  unitSize: number;
}
