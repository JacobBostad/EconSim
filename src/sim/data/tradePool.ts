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

/**
 * The fraction of a product's local consumption the city's own economy produces
 * each day (Arc E step 2). 0 when the def lists nothing for it (fully imported —
 * the deepest export market). A food-leaning port pins this high on its staples
 * and low on its industry; an industrial port mirrors it. See tradeCities.ts.
 */
export function localProductionFraction(cityId: string, pid: ProductId): number {
  return getTradeCity(cityId).productionByProduct[pid] ?? 0;
}

/**
 * A city's own daily LOCAL production of a product (units/day): its production
 * fraction × whole-population consumption. This is the supply side the demand
 * pool gains in step 2 — the stub town produces some of what it consumes, so
 * exports fill only the GAP its production leaves. Deterministic and cash-free
 * (the town's own economy, same rationale as consumption): no rng, no money.
 */
export function poolLocalProductionPerDay(cityId: string, pid: ProductId): number {
  return localProductionFraction(cityId, pid) * poolConsumptionPerDay(cityId, pid);
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
 * The cover-curve itself, factored out so the STUB pool (this file) and the LIVE
 * partner's real-book quote (core/PartnerMarket.ts, Arc E step 4 slice 5) apply
 * the IDENTICAL curve — a target buffer and a stock, unit-elastic and clamped to
 * the walk-layering band. 1.0 at `stock == target`; > 1 (premium) when stock is
 * thin, < 1 (discount) when an overhang piled it up. `target <= 0` (an unconsumed
 * product) ⇒ 1 (no effect). The two paths differ ONLY in where `target`/`stock`
 * come from: the stub reads the def population + the pool inventory dict; the
 * live partner reads its real cohort demand + its real shelf stock.
 */
export function coverMult(target: number, stock: number): number {
  if (target <= 0) return 1; // unconsumed — no cover effect
  const s = Math.max(stock, 1); // avoid div-by-zero; a bare shelf pins the max premium
  const ratio = target / s; // > 1 when short, < 1 when overstocked
  const mult = Math.pow(ratio, TRADE_POOL_COVER_ELASTICITY);
  return Math.min(TRADE_POOL_MULT_MAX, Math.max(TRADE_POOL_MULT_MIN, mult));
}

/**
 * The multiplier the STUB pool applies to a product's walked quote (the live
 * partner uses `partnerCoverMult` on its real book instead — see PartnerMarket).
 * A product the city doesn't consume returns 1.
 */
export function poolCoverMult(cityId: string, pid: ProductId, inventory: number): number {
  return coverMult(poolTargetInventory(cityId, pid), inventory);
}
