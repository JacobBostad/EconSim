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
import { townOf, HOME_TOWN_ID, type TownId } from '../core/Town';
import { cohortAccount, firmAccount } from '../core/Transactions';
import { isDayBoundary, isHourBoundary } from '../core/Tick';
import type { Cohort } from '../entities/Cohort';
import { NEED_BUCKETS } from '../entities/Cohort';
import type { Facility } from '../entities/Facility';
import type { Vec2 } from '../entities/Location';
import { distance } from '../entities/Location';
import { districtAt, shoppingDistrictIds } from '../entities/District';
import { getQuantity, getQuality, removeStock } from '../entities/Inventory';
import { PRODUCTS, COHORT_DEMAND_PRODUCT_IDS, getProduct } from '../data/products';
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

/**
 * Cast stock reservation (soak finding (b): the crowd starves the cast).
 *
 * Within a shop-window tick the crowd settles BEFORE the cast's
 * RetailDemandSystem runs, so on a contended shelf the aggregate eats first —
 * three bakeries cannot feed a 340-person crowd plus a 40-cast, and the cast's
 * satisfaction craters and it emigrates. Before the crowd buys, reserve the
 * cast's population-proportional share of a store's CURRENT stock, so
 * contention becomes proportional instead of ordered: the crowd's purchasable
 * stock is the shelf minus the reserved cast share.
 *
 * This is a fairness FLOOR, not a market distortion. RetailDemandSystem is
 * untouched — the cast still buys from the full shelf as before; reservation
 * only constrains the crowd's VIEW of the stock. When the cast doesn't show
 * up, the reserved units are simply still there next slice. Unmet crowd demand
 * the reservation withholds books to unmetDemand/lostSales exactly as a
 * stockout would.
 *
 * RESERVE_FACTOR scales the reserved share; 1.0 is full proportional
 * reservation. Re-pinned to 1.7 in the A4 geometry recalibration (docs/design/
 * cohorts-and-districts.md, "A4 geometry recalibration"): the 260×184 map's
 * doubled trip lengths mean a cast worker — jobbed ~95-100% and shopping only
 * the narrow after-work window — completes far fewer buys than its frictionless
 * cohort (cast worker sat 49.5 vs cohort 61 at seed 11, gap 11.5). The catch-up
 * lever the A3 small-City tuned (WORKER_CATCHUP_BASKETS) can't close it on the
 * big map — MORE baskets deepen the chronic bread shortage and cast sat FALLS
 * (measured WCB 2→3: cast worker sat 49.5→48.4, gap 11.5→13.9). A super-
 * proportional reservation instead lets the cast's fewer trips land against a
 * protected shelf: 1.7 lifts cast worker sat to ~54-57 and drops the worker
 * cast-vs-cohort gap to 2.6/8.0/5.7 (seeds 11/4/7, from 11.5/6.9/5.4) — and
 * the higher cast sat feeds the curator→comfortable path (a happier cast worker
 * promotes through the cast TierSystem and the curator retires it into the
 * crowd's comfortable cohort), which is what lands the tier bands (see the
 * INFLOW_RATE note in CohortSocialSystem). Swept against the 300-day × 3-seed
 * bands: 1.65 blows seed-4's gap to 18 and leaves seed-7 worker over 70; 1.8
 * pushes seed-11 back over 70/under 25; 1.7 seats all three (worker 68/65/66,
 * comfortable 30/32/31). Cohort-population-gated (crowdPurchasableStock only
 * runs when a cohort shops), so Village is untouched.
 */
const RESERVE_FACTOR = 1.7;

/**
 * The crowd's purchasable share of a shelf after the cast reservation: the
 * current stock minus the cast's population-proportional cut (rounded UP, so a
 * thin shelf still leaves the cast something). Exported for direct testing —
 * `castShare` in [0, 1] is fixed for the slice; `stock` is read live per store.
 */
export function crowdPurchasableStock(stock: number, castShare: number): number {
  const reserved = Math.ceil(stock * castShare * RESERVE_FACTOR);
  return Math.max(0, stock - reserved);
}

// Below these fractions a plan is numerically dead — skip to avoid churning
// zero-mass trips through the shelves and stats.
const VISIT_EPS = 0.0002;
const ELIG_EPS = 0.001;
const ATTEMPT_EPS = 0.0002;

// Products the crowd can crave = the base consumer catalog only
// (COHORT_DEMAND_PRODUCT_IDS) at every preset. The Arc C1 breadth is
// cast/player/founder territory, kept out of the crowd's need loop so the
// pinned A3/A4 city tier calibration stays byte-stable and a crowd never craves
// an unserved product into a founder-blocking satisfaction drag. See products.ts.

function anyCrowd(state: GameState, townId: TownId = HOME_TOWN_ID): boolean {
  // Town-scoped: the scheduler passes ctx.townId so the partner's guard reads
  // the partner's crowd. Home default keeps every one-town caller byte-identical.
  const cohorts = townOf(state, townId).cohorts;
  for (const cid in cohorts) {
    if (cohorts[cid]!.population > 0) return true;
  }
  return false;
}

export function runCohortDemandSystem(ctx: SimContext): void {
  const { state } = ctx;
  // Village stays dark: no crowd means no new code path touches state.
  if (!anyCrowd(state, ctx.townId)) return;

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
  const town = townOf(state, ctx.townId);
  const needspecIds = COHORT_DEMAND_PRODUCT_IDS;
  for (const cid of Object.keys(town.cohorts).sort()) {
    const cohort = town.cohorts[cid]!;
    if (cohort.population <= 0) continue;
    for (const pid of needspecIds) {
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

  // Open, staffed storefronts this slice — the shelves the crowd can reach. Tag
  // each with the district it stands in so a cohort's shopping stays district-
  // local (its home district + adjacent, A4 — the same walking-reach fix the
  // cast's chooseBestStore applies). Cohorts already live in a City/Metropolis
  // town here (Village exits before runSlice via anyCrowd), so every crowd town
  // is district-local by construction.
  const openStores: OpenStore[] = [];
  const town = townOf(state, ctx.townId);
  for (const fid of Object.keys(town.facilities).sort()) {
    const fac = town.facilities[fid]!;
    if (fac.retailProductIds.length === 0) continue;
    if (!storeIsOpen(ctx, fac)) continue;
    const d = districtAt(town.districts, fac.location.x, fac.location.y);
    openStores.push({ facility: fac, districtId: d ? d.id : '' });
  }
  if (openStores.length === 0) return;

  // Which products some open store actually sells — an unservable craving must
  // never target a trip (else capped urgency for a product nobody stocks
  // swallows the softmax and the crowd stops shopping for what it CAN buy).
  const sold: Record<string, boolean> = {};
  for (const pid of COHORT_DEMAND_PRODUCT_IDS) sold[pid] = soldSomewhere(state, pid, ctx.townId);

  // Cast reservation share, computed ONCE per slice (not per store): the cast's
  // town population against the total demand (cast + crowd). A coarse but honest
  // population-proportional proxy for each side's claim on a contended shelf —
  // see RESERVE_FACTOR. Integer sums are order-independent, but iterate sorted
  // to keep with the system's deterministic economic iteration.
  const castPop = Object.keys(town.citizens).length;
  let crowdPop = 0;
  for (const cid of Object.keys(town.cohorts).sort()) crowdPop += town.cohorts[cid]!.population;
  const denom = castPop + crowdPop;
  const castShare = denom > 0 ? castPop / denom : 0;

  for (const cid of Object.keys(town.cohorts).sort()) {
    const cohort = town.cohorts[cid]!;
    if (cohort.population <= 0) continue;
    shopCohortSlice(ctx, cohort, openStores, sold, castShare);
  }
}

/** An open storefront tagged with the district it stands in (A4 district-local
 * shopping). */
interface OpenStore {
  facility: Facility;
  districtId: string;
}

/** Center of a cohort's home district — its representative shopper's origin.
 * Bare-`state` helper mid-gradient: reads the home town by default (one-town
 * region → identical reference). Gains a `townId` param when the endgame move
 * lands and a second town exists — see the recipe in region.md § step 3. */
function districtCenter(state: GameState, districtId: string, townId: TownId = HOME_TOWN_ID): Vec2 {
  // Town-scoped: the cohort's home district lives in ITS town, so the partner's
  // shopper origin must read the partner's districts (ctx.townId), not home's —
  // a home default would return {0,0} for a partner district id and misplace the
  // representative shopper. Home default is byte-identical for one-town callers.
  const d = townOf(state, townId).districts[districtId];
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
  const town = townOf(state, ctx.townId);
  if (!facility.retailProductIds.includes(productId)) return null;
  const product = getProduct(productId);
  const price = storePrice(state, facility, productId, ctx.townId);
  const stock = getQuantity(facility.inputInventory, productId);
  const quality = getQuality(facility.inputInventory, productId);

  const availabilityScore = stock > 0 ? 1 : 0;
  const priceScore = clamp(product.basePrice / Math.max(1, price), 0, 2) / 2;
  const dist = distance(home, facility.location);
  const distanceScore = 1 - clamp(dist / config.maxShoppingDistance, 0, 1);
  const qualityScore = quality / 100;
  const firm = town.firms[facility.ownerFirmId];
  const brandScore = clamp((firm?.brandByProduct[productId] ?? 0) / 100, 0, 1);
  const reliabilityScore = COHORT_RELIABILITY;
  const ageDays = (state.tick - facility.builtAtTick) / (config.ticksPerHour * 24);
  const noveltyScore =
    facility.builtAtTick > 0 && ageDays < 15 ? 0.12 * (1 - ageDays / 15) : 0;
  const affinity = positioningAffinity(facility.positioning, cohort.tier, {
    avgQuality: quality,
    price,
    marketAvgPrice: town.marketStats[productId]?.averagePrice || product.basePrice,
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
  openStores: OpenStore[],
  sold: Record<string, boolean>,
  castShare: number,
): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const pop = cohort.population;
  const empShare = pop > 0 ? cohort.employed / pop : 0;
  // Per-slice trip budget: the daily per-capita rate split across the 5 slices.
  const totalVisits = (pop * (T_EMP * empShare + T_UNEMP * (1 - empShare))) / SLICES;
  const home = districtCenter(state, cohort.districtId, ctx.townId);
  // District-local shopping (A4): the cohort only reaches stores in its home
  // district plus adjacent quarters — the crowd analogue of the cast's
  // chooseBestStore restriction. Stores outside are dropped from its store split.
  const allowed = shoppingDistrictIds(townOf(state, ctx.townId).districts, cohort.districtId);
  const reachable = openStores.filter((s) => allowed.has(s.districtId));
  if (reachable.length === 0) return;

  // Softmax targeting over bucket-mean urgency (only buckets above the trip
  // gate count toward the mean), spec-order biased, servable products only.
  const tripW: Record<string, number> = {};
  let tripWSum = 0;
  for (const pid of COHORT_DEMAND_PRODUCT_IDS) {
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
    for (const st of reachable) {
      const s = cohortStoreScore(ctx, cohort, st.facility, pid, home);
      if (s === null) continue;
      const sc = Math.max(0, s);
      const w = sc * sc;
      scored.push({ id: st.facility.id, w });
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
    const store = town.facilities[stid]!;
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
      const qty = attemptCohortPurchase(ctx, cohort, store, pid, v, eligFrac, castShare);
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
  castShare: number,
): number {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const product = getProduct(productId);
  const spec = product.needSpec!;
  const stat = town.marketStats[productId]!;
  const price = storePrice(state, store, productId, ctx.townId);
  const stock = getQuantity(store.inputInventory, productId);
  const quality = getQuality(store.inputInventory, productId);
  const firm = town.firms[store.ownerFirmId];
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

  // Priced-out shopper-events: the fraction of eligible visitors who walked
  // because the shelf price cleared their walkaway cap. Booked whether or not
  // the remaining buyers can be served (a satisfaction signal, not a sale).
  cohort.dayEvents.pricedOut += visits * eligFrac * (1 - buyFrac);

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
  // Reserve the cast's proportional share of the CURRENT shelf before the crowd
  // takes any (soak finding (b) — the crowd settles before the cast's
  // RetailDemandSystem, so an ordered shelf lets the aggregate eat first). The
  // crowd may only buy from what remains; the cast (RetailDemandSystem) still
  // sees the full shelf. Withheld units surface as unmet crowd demand below.
  const crowdStock = crowdPurchasableStock(stock, castShare);
  const qty = Math.floor(Math.min(attempted, crowdStock, affordableUnits));
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

  // Fulfilled shopper-events: units bought expressed as satisfied basket-fills.
  if (qty > 0) cohort.dayEvents.fulfilled += qty / wantQty;

  const unmet = attempted - qty;
  if (unmet > 0) {
    stat.unmetDemand += unmet;
    store.dailyStats.lostSales += unmet;
    // Unmet shopper-events: the shortfall as basket-fills the crowd wanted but
    // the shelf couldn't cover.
    cohort.dayEvents.unmet += unmet / wantQty;
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
