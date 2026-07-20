/**
 * RetailDemandSystem — citizens shopping at stores.
 *
 * Store selection uses the documented weighted score (availability, price,
 * distance, quality, reliability) plus small seeded jitter. A citizen who has
 * arrived at a store (activity 'shopping') attempts to buy the store's product
 * for their matching need. Successful purchases move cash citizen->firm, reduce
 * inventory and need urgency, and update market stats; stockouts and
 * unaffordable prices create unmet demand and lost sales.
 *
 * `chooseBestStore` is exported and reused by CitizenScheduleSystem to route a
 * shopper to a store.
 */

import type { SimContext, GameState } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import {
  citizenAccount,
  firmAccount,
} from '../core/Transactions';
import type { Citizen } from '../entities/Citizen';
import type { Facility } from '../entities/Facility';
import { crowdCount } from '../entities/Facility';
import type { ProductId } from '../core/Id';
import { getQuantity, getQuality, removeStock } from '../entities/Inventory';
import { distance } from '../entities/Location';
import { getProduct } from '../data/products';
import { worldDemandMult, worldSpendingMult } from '../data/worldEvents';
import { seasonDemandMult } from '../data/seasons';
import { tierPriceCapMult, positioningAffinity, positioningPriceImage } from './TierSystem';
import { clamp } from '../../utils/clamp';

/** Extra baskets any URGENT need buys in one stop for a crowd-town cast WORKER
 * (see the catch-up in attemptPurchase). Two ≈ the throughput of the separate
 * urgent trips the after-work shop window denies the fully-jobbed cast worker,
 * the count measured to close the cast-vs-cohort worker satisfaction gap on the
 * City soak without over-clearing (which spikes promotion and destabilises the
 * cast sample). */
const WORKER_CATCHUP_BASKETS = 2;

/** Whether any crowd cohort holds population — the gate that keeps the crowd-
 * scale backlog catch-up (see attemptPurchase) dark in a Village, so the 300-day
 * Village re-run stays bit-identical. Exported for that mechanism's test. */
export function anyCohortPopulation(state: GameState): boolean {
  for (const cid in state.cohorts) {
    if (state.cohorts[cid]!.population > 0) return true;
  }
  return false;
}

/** Price a firm charges for a product (falls back to base price). */
export function storePrice(state: GameState, facility: Facility, productId: ProductId): number {
  const firm = state.firms[facility.ownerFirmId];
  const p = firm?.pricesByProduct[productId];
  return p && p > 0 ? p : getProduct(productId).basePrice;
}

export interface StoreScore {
  facility: Facility;
  score: number;
  price: number;
}

/** Whether a store is currently open and able to serve customers. */
export function storeIsOpen(ctx: SimContext, facility: Facility): boolean {
  if (facility.type !== 'retail' || facility.status === 'closed') return false;
  if (facility.employees.length === 0 && crowdCount(facility) === 0) return false;
  const h = ctx.time.hour;
  return h >= ctx.config.storeOpenHour && h < ctx.config.storeCloseHour;
}

/**
 * Score a single store for a citizen + product per the documented formula.
 * Returns null if the store does not sell the product.
 */
export function scoreStore(
  ctx: SimContext,
  citizen: Citizen,
  facility: Facility,
  productId: ProductId,
): StoreScore | null {
  if (!facility.retailProductIds.includes(productId)) return null;
  const product = getProduct(productId);
  const home = ctx.state.facilities[citizen.homeFacilityId];
  const refPrice = product.basePrice;
  const price = storePrice(ctx.state, facility, productId);
  const stock = getQuantity(facility.inputInventory, productId);

  const availabilityScore = stock > 0 ? 1 : 0;
  const priceScore = clamp(refPrice / Math.max(1, price), 0, 2) / 2;
  const dist = home ? distance(home.location, facility.location) : 0;
  const distanceScore = 1 - clamp(dist / ctx.config.maxShoppingDistance, 0, 1);
  const qualityScore = getQuality(facility.inputInventory, productId) / 100;
  const reliabilityRaw = citizen.storeReliability[facility.id] ?? 0;
  const reliabilityScore =
    reliabilityRaw > 0 ? clamp(reliabilityRaw / 10, 0, 1) : 0.4;
  const firm = ctx.state.firms[facility.ownerFirmId];
  const brandScore = clamp((firm?.brandByProduct[productId] ?? 0) / 100, 0, 1);

  // Grand-opening novelty: citizens try a NEW store (first ~15 days, fading)
  // — without it, zero brand + zero reliability makes cold-start retail
  // mathematically unwinnable against incumbents.
  const ageDays =
    (ctx.state.tick - facility.builtAtTick) / (ctx.config.ticksPerHour * 24);
  const noveltyScore =
    facility.builtAtTick > 0 && ageDays < 15 ? 0.12 * (1 - ageDays / 15) : 0;

  // Positioning: an honest discount sign courts workers; an earned premium
  // sign courts the affluent — unearned signs do nothing (see TierSystem).
  const affinity = positioningAffinity(facility.positioning, citizen.tier, {
    avgQuality: getQuality(facility.inputInventory, productId),
    price,
    marketAvgPrice: ctx.state.marketStats[productId]?.averagePrice || refPrice,
  });

  const score =
    availabilityScore * 0.28 +
    priceScore * 0.22 +
    distanceScore * 0.18 +
    qualityScore * 0.14 +
    brandScore * 0.12 +
    reliabilityScore * 0.06 +
    noveltyScore +
    affinity;

  return { facility, score, price };
}

/** Choose the highest-scoring open store selling `productId`, with jitter. */
export function chooseBestStore(
  ctx: SimContext,
  citizen: Citizen,
  productId: ProductId,
): Facility | null {
  let best: Facility | null = null;
  let bestScore = -Infinity;
  for (const id in ctx.state.facilities) {
    const fac = ctx.state.facilities[id]!;
    if (!fac.retailProductIds.includes(productId)) continue;
    if (fac.status === 'closed') continue;
    if (fac.employees.length === 0 && crowdCount(fac) === 0) continue;
    const scored = scoreStore(ctx, citizen, fac, productId);
    if (!scored) continue;
    const jittered = scored.score + ctx.rng.jitter(ctx.config.storeScoreJitter);
    if (jittered > bestScore) {
      bestScore = jittered;
      best = fac;
    }
  }
  return best;
}

export function runRetailDemandSystem(ctx: SimContext): void {
  const { state } = ctx;
  for (const id in state.citizens) {
    const cit = state.citizens[id]!;
    if (cit.activity !== 'shopping' || cit.movementState !== 'idle') continue;
    const store = cit.targetFacilityId ? state.facilities[cit.targetFacilityId] : null;
    // Whatever happens, after a shopping visit the citizen heads home.
    sendHome(ctx, cit);
    if (!store || store.retailProductIds.length === 0) continue;

    // Basket shopping: while here, buy EVERY need this store can serve (most
    // urgent first). This is what makes multi-product stores economical —
    // one staffed storefront, several revenue streams per visit.
    const wants = cit.needs
      .filter(
        (n) =>
          store.retailProductIds.includes(n.productId) &&
          n.urgency >= ctx.config.needUrgencyThreshold * 0.6,
      )
      .sort((a, b) => b.urgency - a.urgency);
    for (const need of wants) {
      attemptPurchase(ctx, cit, store, need.productId, need);
    }
  }
}

function attemptPurchase(
  ctx: SimContext,
  cit: Citizen,
  store: Facility,
  productId: ProductId,
  need: Citizen['needs'][number],
): void {
  const { state } = ctx;
  const product = getProduct(productId);
  const stat = state.marketStats[productId]!;
  stat.demandAttempts += 1;

  const open = storeIsOpen(ctx, store);
  const stock = getQuantity(store.inputInventory, productId);
  const price = storePrice(state, store, productId);
  // Strong brands and high quality raise what citizens will pay.
  const firm = state.firms[store.ownerFirmId];
  const brand = firm?.brandByProduct[productId] ?? 0;
  const qual = getQuality(store.inputInventory, productId);
  const premium = 1 + brand / 250 + (qual - 50) / 300;
  // Booms/recessions move what citizens will pay; fads move how much they
  // buy; affluent citizens tolerate premium prices on favorite categories;
  // positioning sets the price image (discount shoppers expect discounts,
  // premium shoppers accept a markup — if the quality earns the sign).
  const maxPrice =
    product.basePrice *
    need.maxAffordablePriceMultiplier *
    premium *
    worldSpendingMult(state) *
    tierPriceCapMult(cit.tier, productId) *
    positioningPriceImage(store.positioning, qual);

  let wantQty = Math.max(
    1,
    Math.round(
      need.preferredQuantity *
        worldDemandMult(state, productId) *
        seasonDemandMult(state, productId),
    ),
  );
  // Worker backlog catch-up (crowd towns only). LaborSystem's cast priority
  // jobs the city cast at ~95-100%, so a cast WORKER shops only the narrow
  // after-work window — measured ~2 trips/day against ~4 urgent needs. It cannot
  // make enough separate staple trips, and adding trips only piles on closed-
  // door/contention losses (probe: extra cast trips pushed bread urgency
  // 2.55->2.97, worse). The crowd cohorts have no such ceiling: CohortDemandSystem
  // grants URGENT_TRIPS — extra same-day visits for any need over the urgent bar
  // — so for the SAME worker the aggregate model provisions staples ~2x/capita
  // (bread ~1.17 vs cast ~0.54 buys/day) and its bucket urgency settles ~1.35
  // while the cast pins ~2.5. THAT model mismatch — not employment (already +19
  // in the cast's favour) and not shelf stock (RESERVE_FACTOR and founder-supply
  // sweeps both left cast bread urgency pinned: it is trip-limited, not shelf-
  // limited) — is the whole cast-vs-cohort worker gap (probe: cast prov -23/-29
  // vs cohort -1.5). The cast's answer to URGENT_TRIPS, WITHOUT minting
  // contention-producing trips, is to fold that missed throughput into the visit
  // it DOES make: ANY need over the urgent bar buys WORKER_CATCHUP_BASKETS extra
  // baskets in one stop (need-agnostic, matching the cohorts' need-agnostic
  // URGENT_TRIPS), standing in for the separate trips the window denied it. A
  // FIXED count (not urgency-scaled) was the measured choice: scaling by urgency
  // over-clears the most-starved worker in a burst, spiking them past the
  // promotion bar and destabilising the cast sample (round(urgency) left seed-11
  // overshooting to -11.6 with the crowd worker cohort dragged down to 53); a
  // flat two-basket top-up lifts the tier evenly and lands both seeds within
  // tolerance with the crowd cohort held near its band (200d soak, 15-day mean:
  // worker gap seed-11 6.5->3.5, seed-7 24.2->2.0 — the worst case — cast worker
  // sat 39->50, cast population 30->80).
  //
  // WORKER tier only, and only in a live crowd. Workers are the tier the
  // divergence afflicts; the comfortable/affluent cast already track their
  // cohorts, so extending the catch-up to them over-provisions and flips their
  // parity — measured (200d soak, seed 7: comfortable gap 0.0 vs -18.9 when
  // applied to all tiers). The crowd gate keeps this dark in a Village, so the
  // 300-day Village re-run stays bit-identical (verified).
  if (
    cit.tier === 'worker' &&
    need.urgency > ctx.config.needUrgentThreshold &&
    anyCohortPopulation(state)
  ) {
    wantQty += WORKER_CATCHUP_BASKETS * need.preferredQuantity;
  }

  if (!open || stock <= 0) {
    // Stockout / store closed -> lost sale. Both cases keep feeding
    // lostSales — the shelf-widening and pricing equilibrium was measured
    // with after-hours arrivals included, and removing them was probed to
    // starve the whole town (immigration stalls at ~42). But the closed-door
    // share is tracked separately so the daily digest can tell the player
    // the truth instead of reporting "stockouts" at a fully stocked store.
    if (!open) store.dailyStats.closedDoorVisits = (store.dailyStats.closedDoorVisits ?? 0) + wantQty;
    store.dailyStats.lostSales += wantQty;
    stat.unmetDemand += wantQty;
    stat.stockoutCount += 1;
    cit.dailyStats.unmetNeeds += 1;
    cit.satisfaction = clamp(cit.satisfaction - 2, 0, 100);
    return;
  }

  if (price > maxPrice) {
    // Too expensive -> walk away unsatisfied. Counted separately from
    // stockouts so the price controller can SEE priced-out demand — without
    // this signal, prices ride the market-power ceiling right past what the
    // town can afford and demand quietly dies.
    stat.unmetDemand += wantQty;
    store.dailyStats.pricedOut += wantQty;
    cit.dailyStats.unmetNeeds += 1;
    cit.satisfaction = clamp(cit.satisfaction - 1, 0, 100);
    return;
  }

  const affordableQty = Math.floor(cit.cash / price);
  const qty = Math.min(wantQty, affordableQty, stock);
  if (qty <= 0) {
    stat.unmetDemand += wantQty;
    cit.dailyStats.unmetNeeds += 1;
    cit.satisfaction = clamp(cit.satisfaction - 1, 0, 100);
    return;
  }

  const revenue = qty * price;
  const quality = getQuality(store.inputInventory, productId);
  removeStock(store.inputInventory, productId, qty);
  recordTransaction(state, {
    from: citizenAccount(cit.id),
    to: firmAccount(store.ownerFirmId),
    amount: revenue,
    firmId: store.ownerFirmId,
    category: 'revenue',
    productId,
    quantity: qty,
    note: `${cit.name} bought ${qty} ${product.name}`,
  });

  // Update need + citizen memory + stats.
  need.urgency = Math.max(
    0,
    need.urgency - qty / Math.max(1, need.preferredQuantity),
  );
  need.lastSatisfiedTick = state.tick;
  cit.satisfaction = clamp(cit.satisfaction + 1.5, 0, 100);
  cit.lastPurchasedFromByProduct[productId] = store.id;
  cit.storeReliability[store.id] = (cit.storeReliability[store.id] ?? 0) + 1;
  cit.dailyStats.purchases += 1;
  cit.dailyStats.spent += revenue;

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

  if (qty < wantQty) {
    const short = wantQty - qty;
    stat.unmetDemand += short;
    store.dailyStats.lostSales += short;
  }
}

function sendHome(ctx: SimContext, cit: Citizen): void {
  const home = ctx.state.facilities[cit.homeFacilityId];
  if (!home) {
    cit.activity = 'home';
    cit.movementState = 'idle';
    return;
  }
  cit.targetFacilityId = home.id;
  cit.targetLocation = { ...home.location };
  cit.activity = 'commuting-home';
  cit.movementState = 'moving';
}
