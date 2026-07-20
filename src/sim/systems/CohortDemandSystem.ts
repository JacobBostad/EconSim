/**
 * CohortDemandSystem — the crowd shops (Arc A3, slice 2).
 *
 * The economic counterpart of RetailDemandSystem: where the named cast walk to
 * a store and basket-buy, the crowd settles its demand as aggregate money flow
 * — but through the SAME shelves, the SAME store scoring, and the SAME market
 * signals, so a firm's AI reads one indistinguishable stream of demand.
 *
 * The model is the shadow-parity probe's, ported wholesale (see
 * docs/design/probes/shadow-parity.ts and the probe verdict in
 * docs/design/cohorts-and-districts.md). Its constants were measured against
 * the live 80-160-agent town over 20 iterations; the header comments here
 * carry the mechanism each one encodes. Two findings drive the whole design:
 *   - agents are VISIT-limited, not urgency-limited (staple urgency saturates
 *     at ~1.6-2.9 while purchases run at trip frequency), so demand settles as
 *     TRIPS — per-capita rates, softmax product targeting, score² store split —
 *     not as `population × rate` unit flow; and
 *   - a cohort's appetite is a distribution, not a mean: NEED_BUCKETS quantile
 *     buckets grown daily and drained lowest-first (proximity decides who
 *     shops — the same well-served citizens buy daily and stay low while the
 *     remote tail pins at the cap).
 *
 * Demand settles in 5 slices across the shop window (hours 16-20) rather than
 * one end-of-day lump, so shelf depletion interleaves with the cast's own
 * shopping and with logistics restocks the way a real crowd's would. The
 * shadow's town-wide supply cap is deliberately absent: A3 slices interleave
 * with real production and logistics ticks, which is ground truth by
 * construction (probe directive — the cap only existed to fake that).
 *
 * This system settles PURCHASES only; it never touches satisfaction or tier
 * composition (CohortSocialSystem owns those). Zero rng draws, sorted
 * iteration throughout, and a town with no crowd (Village preset) exits before
 * mutating anything.
 */

import type { SimContext, GameState } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { cohortAccount, firmAccount } from '../core/Transactions';
import { isDayBoundary, isHourBoundary } from '../core/Tick';
import type { Cohort } from '../entities/Cohort';
import { NEED_BUCKETS } from '../entities/Cohort';
import type { Facility } from '../entities/Facility';
import type { Vec2 } from '../entities/Location';
import { distance } from '../entities/Location';
import { getQuantity, getQuality, removeStock } from '../entities/Inventory';
import { PRODUCTS, ALL_PRODUCT_IDS, getProduct } from '../data/products';
import { worldDemandMult, worldSpendingMult } from '../data/worldEvents';
import { seasonDemandMult } from '../data/seasons';
import { tierNeedGrowthMult, tierPriceCapMult, positioningAffinity, positioningPriceImage } from './TierSystem';
import { soldSomewhere } from './SatisfactionSystem';
import { storePrice, storeIsOpen } from './RetailDemandSystem';
import { clamp } from '../../utils/clamp';

// --- probe-calibrated constants (measured against the live town; see the
// shadow-parity probe header for the derivation of each) -------------------

/** Buckets never accumulate past this urgency (matches SatisfactionSystem). */
const URGENCY_CAP = 3;
/** A lapsed luxury craving fades this fast for a tier that no longer wants it. */
const LUXURY_DECAY = 0.1;

/** Settlement slices across the shop window — one per hour boundary, hours
 * 16-20 inclusive. Five slices let the shelves deplete as the cast shops. */
const SLICES = 5;
const SLICE_START_HOUR = 16;
const SLICE_END_HOUR = 20;

/** Trips per capita per DAY: agents are visit-limited, so demand is trip
 * frequency, not a unit rate. Unemployed shop more (home all day). */
const T_EMP = 0.8;
const T_UNEMP = 1.4;
/** Extra same-day trips for chronically urgent needs (a second visit pool over
 * products whose urgency clears the urgent bar), per capita per day. */
const URGENT_TRIPS = 0.75;

/** Trip targeting is a sharp softmax over need urgency with a spec-order tie
 * bias — reproduces bread's outsized share of store visits (ties at the
 * urgency cap resolve to spec order). Temperature and bias measured. */
const TRIP_TEMP = 0.25;
const ORDER_BIAS = 0.02;

/** A bucket this urgent triggers a trip; a bucket merely this urgent gets
 * bought in passing once a trip lands (0.6 × trip gate). */
const TRIP_GATE = 0.5;
const BASKET_GATE = 0.3;
/** A need at/above this urgency is "urgent" and earns repeat visits. */
const URGENT_BAR = 1.1;

/** Store visits keep no per-cohort memory — reliability is the no-history
 * default the agent scorer uses for a store a citizen has never visited. */
const COHORT_RELIABILITY = 0.4;

// Below these fractions a plan is numerically dead — skip to avoid churning
// zero-mass trips through the shelves and stats.
const VISIT_EPS = 0.0002;
const ELIG_EPS = 0.001;
const ATTEMPT_EPS = 0.0002;

/** Products the crowd can crave (have a needSpec) — the only ones with buckets. */
const NEEDSPEC_PRODUCT_IDS: string[] = ALL_PRODUCT_IDS.filter((pid) => PRODUCTS[pid]!.needSpec);

function anyCrowd(state: GameState): boolean {
  for (const cid in state.cohorts) {
    if (state.cohorts[cid]!.population > 0) return true;
  }
  return false;
}

export function runCohortDemandSystem(ctx: SimContext): void {
  const { state } = ctx;
  // Village stays dark: no crowd means no new code path touches state.
  if (!anyCrowd(state)) return;

  // Daily: grow every cohort's appetite (mirrors SatisfactionSystem's need
  // growth, per bucket rather than per citizen).
  if (isDayBoundary(state.tick, ctx.config)) growBuckets(ctx);

  // Shop-window slices settle the crowd's demand into the real shelves.
  if (
    isHourBoundary(state.tick, ctx.config) &&
    ctx.time.hour >= SLICE_START_HOUR &&
    ctx.time.hour <= SLICE_END_HOUR
  ) {
    runSlice(ctx);
  }
}

/** Daily urgency growth per bucket, capped; luxury a tier stopped wanting
 * decays toward 0 (exactly SatisfactionSystem's rule, applied per bucket). */
function growBuckets(ctx: SimContext): void {
  const { state } = ctx;
  for (const cid of Object.keys(state.cohorts).sort()) {
    const cohort = state.cohorts[cid]!;
    if (cohort.population <= 0) continue;
    for (const pid of NEEDSPEC_PRODUCT_IDS) {
      const spec = PRODUCTS[pid]!.needSpec!;
      const g = (spec.growthPerDay[0] + spec.growthPerDay[1]) / 2;
      const mult = tierNeedGrowthMult(cohort.tier, pid);
      const b = cohort.needBuckets[pid];
      if (!b) continue;
      const luxuryLapsed = mult <= 0 && getProduct(pid).needType === 'luxury';
      for (let i = 0; i < NEED_BUCKETS; i++) {
        if (luxuryLapsed) {
          b[i] = Math.max(0, b[i]! - LUXURY_DECAY);
        } else {
          b[i] = Math.min(URGENCY_CAP, b[i]! + g * mult);
        }
      }
    }
  }
}

function runSlice(ctx: SimContext): void {
  const { state } = ctx;

  // Open, staffed storefronts this slice — the shelves the crowd can reach.
  const openStores: Facility[] = [];
  for (const fid of Object.keys(state.facilities).sort()) {
    const fac = state.facilities[fid]!;
    if (fac.retailProductIds.length === 0) continue;
    if (!storeIsOpen(ctx, fac)) continue;
    openStores.push(fac);
  }
  if (openStores.length === 0) return;

  // Which products some open store actually sells — an unservable craving must
  // never target a trip (else capped urgency for a product nobody stocks
  // swallows the softmax and the crowd stops shopping for what it CAN buy).
  const sold: Record<string, boolean> = {};
  for (const pid of NEEDSPEC_PRODUCT_IDS) sold[pid] = soldSomewhere(state, pid);

  for (const cid of Object.keys(state.cohorts).sort()) {
    const cohort = state.cohorts[cid]!;
    if (cohort.population <= 0) continue;
    shopCohortSlice(ctx, cohort, openStores, sold);
  }
}

/** Center of a cohort's home district — its representative shopper's origin. */
function districtCenter(state: GameState, districtId: string): Vec2 {
  const d = state.districts[districtId];
  if (!d) return { x: 0, y: 0 };
  return { x: d.bounds.x + d.bounds.w / 2, y: d.bounds.y + d.bounds.h / 2 };
}

/**
 * scoreStore adapted for a cohort's representative shopper: reliability is the
 * 0.4 no-history default (cohorts keep no per-store memory) and the origin is
 * the district center rather than a specific home. Every other term reads live
 * state exactly as the agent scorer does. Pure — draws no rng jitter (the
 * agents' `chooseBestStore` does; the crowd must not perturb the shared
 * stream), so the score² split below is the only randomness-free stand-in for
 * per-citizen store choice.
 */
function cohortStoreScore(
  ctx: SimContext,
  cohort: Cohort,
  facility: Facility,
  productId: string,
  home: Vec2,
): number | null {
  const { state, config } = ctx;
  if (!facility.retailProductIds.includes(productId)) return null;
  const product = getProduct(productId);
  const price = storePrice(state, facility, productId);
  const stock = getQuantity(facility.inputInventory, productId);
  const quality = getQuality(facility.inputInventory, productId);

  const availabilityScore = stock > 0 ? 1 : 0;
  const priceScore = clamp(product.basePrice / Math.max(1, price), 0, 2) / 2;
  const dist = distance(home, facility.location);
  const distanceScore = 1 - clamp(dist / config.maxShoppingDistance, 0, 1);
  const qualityScore = quality / 100;
  const firm = state.firms[facility.ownerFirmId];
  const brandScore = clamp((firm?.brandByProduct[productId] ?? 0) / 100, 0, 1);
  const reliabilityScore = COHORT_RELIABILITY;
  const ageDays = (state.tick - facility.builtAtTick) / (config.ticksPerHour * 24);
  const noveltyScore =
    facility.builtAtTick > 0 && ageDays < 15 ? 0.12 * (1 - ageDays / 15) : 0;
  const affinity = positioningAffinity(facility.positioning, cohort.tier, {
    avgQuality: quality,
    price,
    marketAvgPrice: state.marketStats[productId]?.averagePrice || product.basePrice,
  });

  return (
    availabilityScore * 0.28 +
    priceScore * 0.22 +
    distanceScore * 0.18 +
    qualityScore * 0.14 +
    brandScore * 0.12 +
    reliabilityScore * 0.06 +
    noveltyScore +
    affinity
  );
}

/** One cohort's turn in one slice: target trips, split them over stores, and
 * basket-buy — draining the shopped products' buckets lowest-first. */
function shopCohortSlice(
  ctx: SimContext,
  cohort: Cohort,
  openStores: Facility[],
  sold: Record<string, boolean>,
): void {
  const { state } = ctx;
  const pop = cohort.population;
  const empShare = pop > 0 ? cohort.employed / pop : 0;
  // Per-slice trip budget: the daily per-capita rate split across the 5 slices.
  const totalVisits = (pop * (T_EMP * empShare + T_UNEMP * (1 - empShare))) / SLICES;
  const home = districtCenter(state, cohort.districtId);

  // Softmax targeting over bucket-mean urgency (only buckets above the trip
  // gate count toward the mean), spec-order biased, servable products only.
  const tripW: Record<string, number> = {};
  let tripWSum = 0;
  for (const pid of NEEDSPEC_PRODUCT_IDS) {
    if (!sold[pid]) continue;
    const b = cohort.needBuckets[pid];
    if (!b) continue;
    let uSum = 0;
    for (let i = 0; i < NEED_BUCKETS; i++) if (b[i]! >= TRIP_GATE) uSum += b[i]!;
    const uMean = uSum / NEED_BUCKETS;
    if (uMean <= 0) continue;
    const w = Math.exp((uMean - ORDER_BIAS * PRODUCTS[pid]!.needSpec!.order) / TRIP_TEMP);
    tripW[pid] = w;
    tripWSum += w;
  }
  if (tripWSum <= 0) return; // nothing urgent enough to leave the house for

  // Urgent repeat trips: a second pool over products whose urgency clears the
  // urgent bar, weighted by softmax weight × urgent fraction.
  const urgW: Record<string, number> = {};
  let urgWSum = 0;
  for (const pid of Object.keys(tripW).sort()) {
    const b = cohort.needBuckets[pid]!;
    let urCount = 0;
    for (let i = 0; i < NEED_BUCKETS; i++) if (b[i]! >= URGENT_BAR) urCount++;
    const urFrac = urCount / NEED_BUCKETS;
    if (urFrac > 0) {
      urgW[pid] = tripW[pid]! * urFrac;
      urgWSum += urgW[pid]!;
    }
  }
  const urgentVisits = urgWSum > 0 ? (pop * URGENT_TRIPS) / SLICES : 0;

  // Split each product's trips over the stores that sell it, share ∝ score².
  const visitsByStore: Record<string, number> = {};
  const allocate = (pid: string, visits: number): void => {
    if (visits <= 0) return;
    const scored: { id: string; w: number }[] = [];
    let wsum = 0;
    for (const st of openStores) {
      const s = cohortStoreScore(ctx, cohort, st, pid, home);
      if (s === null) continue;
      const sc = Math.max(0, s);
      const w = sc * sc;
      scored.push({ id: st.id, w });
      wsum += w;
    }
    if (wsum <= 0) return; // nobody sells it: the trip never starts
    for (const s of scored) {
      visitsByStore[s.id] = (visitsByStore[s.id] ?? 0) + (visits * s.w) / wsum;
    }
  };
  for (const pid of Object.keys(tripW).sort()) {
    allocate(pid, (totalVisits * tripW[pid]!) / tripWSum);
  }
  if (urgWSum > 0) {
    for (const pid of Object.keys(urgW).sort()) {
      allocate(pid, (urgentVisits * urgW[pid]!) / urgWSum);
    }
  }

  // Basket-buy at every visited store, then drain the shopped products.
  const fulfilledBy: Record<string, number> = {};
  for (const stid of Object.keys(visitsByStore).sort()) {
    const v = visitsByStore[stid]!;
    if (v <= VISIT_EPS) continue;
    const store = state.facilities[stid]!;
    for (const pid of [...store.retailProductIds].sort()) {
      const spec = PRODUCTS[pid]?.needSpec;
      if (!spec) continue;
      const b = cohort.needBuckets[pid];
      if (!b) continue;
      // Smooth participation: a regrowing bucket just under the gate still
      // holds members who cleared it today (the buyer rotation is per-citizen).
      let eSum = 0;
      for (let i = 0; i < NEED_BUCKETS; i++) eSum += Math.min(1, b[i]! / BASKET_GATE);
      const eligFrac = eSum / NEED_BUCKETS;
      if (eligFrac <= ELIG_EPS) continue;
      const qty = attemptCohortPurchase(ctx, cohort, store, pid, v, eligFrac);
      if (qty > 0) fulfilledBy[pid] = (fulfilledBy[pid] ?? 0) + qty;
    }
  }
  for (const pid of Object.keys(fulfilledBy).sort()) {
    drainBuckets(ctx, cohort, pid, fulfilledBy[pid]!);
  }
}

/**
 * Settle one cohort × store × product purchase for this slice. Books exactly
 * the signals a cast purchase does (RetailDemandSystem.attemptPurchase) so AI
 * pricing can't tell a crowd customer from a thousand agent ones. Fractional
 * demand rounds DOWN to whole units so inventory and money stay integral;
 * unmet attempted units feed the shortage signals. Returns units bought.
 */
function attemptCohortPurchase(
  ctx: SimContext,
  cohort: Cohort,
  store: Facility,
  productId: string,
  visits: number,
  eligFrac: number,
): number {
  const { state } = ctx;
  const product = getProduct(productId);
  const spec = product.needSpec!;
  const stat = state.marketStats[productId]!;
  const price = storePrice(state, store, productId);
  const stock = getQuantity(store.inputInventory, productId);
  const quality = getQuality(store.inputInventory, productId);
  const firm = state.firms[store.ownerFirmId];
  const brand = firm?.brandByProduct[productId] ?? 0;

  // Strong brands and quality raise what shoppers will pay; booms/recessions,
  // tier taste, and an earned premium sign move the walkaway cap the same way
  // they do for the cast.
  const premium = 1 + brand / 250 + (quality - 50) / 300;
  const mpMid = (spec.maxPriceMult[0] + spec.maxPriceMult[1]) / 2;
  const cap =
    product.basePrice *
    mpMid *
    premium *
    worldSpendingMult(state) *
    tierPriceCapMult(cohort.tier, productId) *
    positioningPriceImage(store.positioning, quality);
  // Per-citizen walkaway caps are drawn from a ±~10% range, so the cohort's
  // price participation is a logistic in price, not a cliff.
  const buyFrac = 1 / (1 + Math.exp((price - cap) / (0.06 * Math.max(1, cap))));

  const wantQty = Math.max(
    1,
    Math.round(spec.preferredQuantity * worldDemandMult(state, productId) * seasonDemandMult(state, productId)),
  );
  const attempted = visits * eligFrac * wantQty * buyFrac;
  if (attempted <= ATTEMPT_EPS) return 0;
  // The cast books one attempt per shopper; the crowd books the number of
  // shoppers this aggregate represents, so fill-rate signals derived from
  // demandAttempts stay count-comparable across the two demand streams.
  stat.demandAttempts += visits * eligFrac * buyFrac;

  const affordableUnits = price > 0 ? cohort.cashPool / price : attempted;
  const qty = Math.floor(Math.min(attempted, stock, affordableUnits));
  if (qty > 0) {
    const revenue = qty * price;
    removeStock(store.inputInventory, productId, qty);
    recordTransaction(state, {
      from: cohortAccount(cohort.id),
      to: firmAccount(store.ownerFirmId),
      amount: revenue,
      firmId: store.ownerFirmId,
      category: 'revenue',
      productId,
      quantity: qty,
      note: `Crowd bought ${qty} ${product.name}`,
    });

    store.dailyStats.unitsSold += qty;
    store.dailyStats.revenue += revenue;

    stat.fulfilledDemand += qty;
    stat.unitsSold += qty;
    stat.revenueAccum += revenue;
    stat.qualityAccum += quality * qty;
    stat.unitsSoldByFirm[store.ownerFirmId] =
      (stat.unitsSoldByFirm[store.ownerFirmId] ?? 0) + qty;
    if (stat.lowestPrice === 0 || price < stat.lowestPrice) stat.lowestPrice = price;
    if (price > stat.highestPrice) stat.highestPrice = price;
  }

  const unmet = attempted - qty;
  if (unmet > 0) {
    stat.unmetDemand += unmet;
    store.dailyStats.lostSales += unmet;
  }
  return qty;
}

/**
 * Purchases drain urgency, LOWEST eligible buckets first — proximity decides
 * who shops, and it is the same well-served citizens every day, so their
 * urgency stays low while the remote tail pins at the cap (both most-urgent-
 * first and ∝-urgency were measured to over-rotate the cohort and crush the
 * persistent high-u tail that keeps the town's mean urgency ~2). A full
 * bucket-buy is (pop/NEED_BUCKETS) × wantQty units and drops that bucket by
 * wantQty/preferredQuantity, floored at 0 — over-buys waste urgency exactly
 * like the agents' `min(u, qty/prefQ)`.
 */
function drainBuckets(ctx: SimContext, cohort: Cohort, productId: string, unitsBought: number): void {
  const { state } = ctx;
  const spec = PRODUCTS[productId]!.needSpec!;
  const prefQ = spec.preferredQuantity;
  const wantQty = Math.max(
    1,
    Math.round(prefQ * worldDemandMult(state, productId) * seasonDemandMult(state, productId)),
  );
  const b = cohort.needBuckets[productId];
  if (!b) return;
  const bucketCap = (cohort.population / NEED_BUCKETS) * wantQty; // one bucket's people buying once
  if (bucketCap <= 0) return;

  const elig: number[] = [];
  for (let i = 0; i < NEED_BUCKETS; i++) if (b[i]! >= BASKET_GATE) elig.push(i);
  elig.sort((x, y) => b[x]! - b[y]!);

  let remaining = unitsBought;
  for (const i of elig) {
    if (remaining <= 0) break;
    const take = Math.min(bucketCap, remaining);
    b[i] = Math.max(0, b[i]! - (take / bucketCap) * (wantQty / prefQ));
    remaining -= take;
  }
}
