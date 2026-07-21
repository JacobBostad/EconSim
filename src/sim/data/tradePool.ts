/**
 * tradePool.ts — the trade-city demand pool (Arc E slice; see
 * docs/design/region.md and the CHANGELOG Arc E entry).
 *
 * Each opt-in trade city carries a TINY cohort-style consumption model: an
 * inventory per consumer product that exports refill and daily consumption
 * drains, with the quote picking up a premium (thin cover) or discount (an
 * export overhang) off the resulting COVER — days of stock on hand. It is a
 * PURE PRICE MODEL: it holds no money (exports still settle firm↔world through
 * recordTransaction, conserved to the cent) and draws no shared rng (every
 * quantity here is a deterministic function of population × product spec ×
 * stored inventory, sorted-product iteration throughout). The pool only ever
 * materializes when config.tradeDemandPoolsEnabled is on, so every pinned
 * baseline — where the flag is off — runs the untouched random walk with no
 * pool state serialized at all.
 *
 * Consumption is read straight off each product's needSpec at its SPEC
 * MIDPOINT — the same numbers the crowd's cohorts grow their need buckets from
 * — so a staple (bread) drains fast and a luxury (jewelry) barely at all,
 * without a second hand-authored demand table to keep in sync.
 */

import type { ProductId } from '../core/Id';
import { getProduct } from './products';
import { getTradeCity } from './tradeCities';
import {
  TRADE_POOL_TARGET_COVER_DAYS,
  TRADE_POOL_COVER_ELASTICITY,
  TRADE_POOL_MULT_MIN,
  TRADE_POOL_MULT_MAX,
} from './constants';

/** The pool's per-city serialized state: inventory (units) per consumer
 * product. consumptionPerDay/targetInventory are DERIVED (population × spec),
 * never stored — they can't drift and keep saves minimal. */
export interface TradeCityPool {
  /** Off-map population this pool consumes for (copied from the city def at
   * init so a running game is self-describing). */
  population: number;
  /** Units on hand per product. Exports add, daily consumption drains. */
  inventory: Partial<Record<ProductId, number>>;
}

/** Midpoint of a `[lo, hi]` range or the scalar itself (luxuries pin a scalar). */
function mid(v: [number, number] | number): number {
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

/**
 * Per-capita daily consumption of a product, read off its needSpec at the spec
 * midpoint: the daily need-growth midpoint × the preferred basket quantity.
 * Raws and intermediates (no needSpec) are not consumed by the populace — the
 * city trades them industrially, so they carry no pool and their quote is the
 * bare walk. Returns 0 for those.
 */
export function perCapitaDailyConsumption(pid: ProductId): number {
  const spec = getProduct(pid).needSpec;
  if (!spec) return 0;
  return mid(spec.growthPerDay) * spec.preferredQuantity;
}

/** A city's whole-population daily consumption of a product (units/day). */
export function poolConsumptionPerDay(cityId: string, pid: ProductId): number {
  return getTradeCity(cityId).population * perCapitaDailyConsumption(pid);
}

/** The inventory level the pool holds in equilibrium (mult 1.0): the target
 * cover buffer × daily consumption. */
export function poolTargetInventory(cityId: string, pid: ProductId): number {
  return TRADE_POOL_TARGET_COVER_DAYS * poolConsumptionPerDay(cityId, pid);
}

/** Days of cover the current inventory represents (inventory ÷ consumption).
 * Infinity for an unconsumed product (guards the callers' divisions). */
export function poolCoverDays(cityId: string, pid: ProductId, inventory: number): number {
  const c = poolConsumptionPerDay(cityId, pid);
  return c > 0 ? inventory / c : Infinity;
}

/**
 * The multiplier the pool applies to a product's walked quote. 1.0 at the
 * target buffer; > 1 (premium) when cover is thin, < 1 (discount) when an
 * export overhang has piled stock up — clamped so the pool layers WITHIN the
 * walk's band, never beyond it. A product the city doesn't consume returns 1.
 */
export function poolCoverMult(cityId: string, pid: ProductId, inventory: number): number {
  const target = poolTargetInventory(cityId, pid);
  if (target <= 0) return 1; // unconsumed here — no pool effect
  const stock = Math.max(inventory, 1); // avoid div-by-zero; a bare shelf pins the max premium
  const ratio = target / stock; // > 1 when short, < 1 when overstocked
  const mult = Math.pow(ratio, TRADE_POOL_COVER_ELASTICITY);
  return Math.min(TRADE_POOL_MULT_MAX, Math.max(TRADE_POOL_MULT_MIN, mult));
}
