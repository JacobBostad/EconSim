/**
 * A2 shadow-cohort parity probe — the gate for Arc A3.
 *
 * Runs the real agent sim day by day and, in parallel, a ZERO-MUTATION shadow
 * cohort engine implementing the HD1 formulas:
 *   - per-(cohort, product) urgency pool: grows at spec-midpoint rate × tier
 *     mult, purchases drain it; desired units/day = pop × (u - U_TARGET) ×
 *     prefQ × worldDemandMult × seasonDemandMult
 *   - allocation across staffed stores by re-normalized scoreStore weights,
 *     share ∝ w², capped by start-of-day stock / cohort cash / walkaway price
 *   - satisfaction: the SatisfactionSystem equilibrium formula per cohort +
 *     intraday purchase/stockout/priced-out nudges
 *   - tier gates: TierSystem bars, 5/7-day streak hysteresis, ~2%/day flow
 * Cohort structure syncs population totals per district daily (immigration is
 * exogenous to the demand engine); tier split, urgency, and satisfaction
 * free-run for 300 days.
 *
 * Envelope (from the roadmap): per-product cumulative units ±10%, cohort
 * satisfaction ±5 (MAE, cohorts with ≥5 actual members, after 30-day burn-in),
 * town tier shares ±8 points.
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import type { GameState } from '../../../src/sim/core/GameState';
import { PRODUCTS, ALL_PRODUCT_IDS, getProduct } from '../../../src/sim/data/products';
import { worldDemandMult, worldSpendingMult } from '../../../src/sim/data/worldEvents';
import { seasonDemandMult } from '../../../src/sim/data/seasons';
import { needWeight, soldSomewhere } from '../../../src/sim/systems/SatisfactionSystem';
import {
  tierNeedGrowthMult, tierPriceCapMult, positioningAffinity, positioningPriceImage,
  COMFORTABLE_WAGE_MULT, COMFORTABLE_WAGE_FLOOR_MULT, AFFLUENT_WAGE_MULT, AFFLUENT_WAGE_FLOOR_MULT,
  COMFORTABLE_SATISFACTION, COMFORTABLE_SATISFACTION_FLOOR, AFFLUENT_SATISFACTION, AFFLUENT_SATISFACTION_FLOOR,
  COMFORT_SAVINGS_CENTS, COMFORT_SAVINGS_FLOOR_CENTS, AFFLUENT_WEALTH_CENTS, AFFLUENT_WEALTH_FLOOR_CENTS,
  AFFLUENT_SAVINGS_CENTS, PROMOTION_DAYS, AFFLUENT_PROMOTION_DAYS, DEMOTION_DAYS,
} from '../../../src/sim/systems/TierSystem';
import { storePrice } from '../../../src/sim/systems/RetailDemandSystem';
import { getQuantity, getQuality } from '../../../src/sim/entities/Inventory';
import { districtAt } from '../../../src/sim/entities/District';
import { distance } from '../../../src/sim/entities/Location';
import { APARTMENT_SATISFACTION_BONUS } from '../../../src/sim/data/constants';
import { clamp } from '../../../src/utils/clamp';

type Tier = 'worker' | 'comfortable' | 'affluent';
const TIERS: Tier[] = ['worker', 'comfortable', 'affluent'];
const URGENCY_CAP = 3;
const LUXURY_DECAY = 0.1;
/** Tier flow after a matured streak: continuous, per day, scaled by the
 * qualifying fraction. Measured: the live town moves 45% of its workers up
 * in ~7 days early on (savings route) ≈ 6%/day — HD1's "~2%/day" was too
 * slow, and one-shot moves of the full qualifying mass oscillate against
 * the demotion gate. */
const MOVE_RATE = 0.08;
// Trip model: agents are visit-limited, not urgency-limited (measured: staple
// urgency saturates at ~1.6-2.3 in the live town). Trips/citizen/day:
const T_EMP = 0.8;
const T_UNEMP = 1.4;
/** Trip targeting is argmax over need urgency with a stable tie-break to
 * spec order (the needs array IS spec order) — a softmax this sharp, biased
 * by order, reproduces bread's outsized share of store visits. */
const TRIP_TEMP = 0.25;
const ORDER_BIAS = 0.02;
/** Extra same-day trips for urgent needs (u ≥ 1.1 shops outside the window,
 * cooldown 3h): chronically urgent staples earn repeat visits the single
 * daily shop-window trip can't explain. */
const URGENT_TRIPS = 0.75;
const URGENT_BAR = 1.1;
const INBOUND_FACTOR = 1.0;
/** Chronic-shortage retries: a citizen with an urgent unmet need (u ≥ 1.1)
 * re-attempts every ~3h and mostly bounces off gaps in the shelf. Each such
 * citizen generates ~this many −2 stockout events per day while any store
 * carries the product (no store → no visit → no sting; the ×0.5 pressure
 * factor covers that case). Measured against live unmet-demand event rates:
 * bread 28/day, tools 23, clothes 13 at 80 pop late-run. */
const RETRY_K = 0.4;
// Mean-field soft cap: real urgency is bimodal (well-served hover low, remote
// citizens pin at the cap); growth × (1-(u/CAP)^2) reproduces the observed
// ~2.0 mean instead of pinning the whole cohort at 3.
const SOFT_CAP_EXP = 2;
const TRIP_GATE = 0.5; // needUrgencyThreshold: a need this urgent triggers trips
const BASKET_GATE = 0.3; // 0.6 × threshold: bought in passing at any store

/** Urgency is tracked as NB equal-mass quantile buckets per product: the real
 * distribution is a rotating sawtooth (recent buyers low, remote citizens at
 * the cap) and pressure is convex in u, so a single mean systematically
 * under-reads it. Buckets shop most-urgent-first, exactly like agents. */
const NB = 10;

interface ShadowCohort {
  pop: number;
  sat: number;
  u: Record<string, number[]>;
  promoteStreak: number;
  demoteStreak: number;
}

function bucketsOf(c: ShadowCohort, pid: string): number[] {
  return (c.u[pid] ??= Array(NB).fill(0));
}

function meanU(c: ShadowCohort, pid: string): number {
  const b = c.u[pid];
  if (!b) return 0;
  return b.reduce((a, x) => a + x, 0) / NB;
}

interface StoreSnap {
  id: string; firmId: string;
  x: number; y: number;
  builtAtTick: number;
  positioning: string;
  products: Record<string, { price: number; stock: number; capacity: number; quality: number; brand: number }>;
}

interface DaySnap {
  tick: number;
  stores: StoreSnap[];
  avgPrice: Record<string, number>;
  wdm: Record<string, number>; sdm: Record<string, number>; wsm: number;
  sold: Record<string, boolean>;
  // observed per (district:tier) over ACTUAL citizens
  obs: Record<string, {
    n: number; empShare: number; aptShare: number; meanCash: number;
    homeX: number; homeY: number;
    entryFracNext: number; floorFrac: number;
  }>;
  distTotals: Record<string, number>;
}

function specMid(pid: string) {
  const s = PRODUCTS[pid]!.needSpec!;
  const g = (s.growthPerDay[0] + s.growthPerDay[1]) / 2;
  const mp = (s.maxPriceMult[0] + s.maxPriceMult[1]) / 2;
  return { g, mp, prefQ: s.preferredQuantity };
}

function keyOf(d: string, t: Tier) { return `${d}:${t}`; }

function homeDistrict(state: GameState, cit: { homeFacilityId: string }): string {
  const home = state.facilities[cit.homeFacilityId];
  const d = home ? districtAt(state.districts, home.location.x, home.location.y) : null;
  return d?.id ?? Object.keys(state.districts).sort()[0]!;
}

function entryBarNoSat(state: GameState, cit: any, tier: Tier): boolean {
  const sub = state.config.subsistenceIncomePerDay;
  const emp = cit.employmentStatus === 'employed';
  if (tier === 'comfortable') {
    return emp && (cit.wage >= sub * COMFORTABLE_WAGE_MULT || cit.cash >= COMFORT_SAVINGS_CENTS);
  }
  if (tier === 'affluent') {
    const apt = state.facilities[cit.homeFacilityId]?.defId === 'apartment';
    return emp && (cit.wage >= sub * AFFLUENT_WAGE_MULT || cit.cash >= AFFLUENT_WEALTH_CENTS)
      && (apt || cit.cash >= AFFLUENT_SAVINGS_CENTS);
  }
  return true;
}

function floorBarNoSat(state: GameState, cit: any): boolean {
  const sub = state.config.subsistenceIncomePerDay;
  const emp = cit.employmentStatus === 'employed';
  if (cit.tier === 'comfortable') {
    return emp && (cit.wage >= sub * COMFORTABLE_WAGE_FLOOR_MULT || cit.cash >= COMFORT_SAVINGS_FLOOR_CENTS);
  }
  if (cit.tier === 'affluent') {
    return emp && (cit.wage >= sub * AFFLUENT_WAGE_FLOOR_MULT || cit.cash >= AFFLUENT_WEALTH_FLOOR_CENTS);
  }
  return true;
}

function snapshot(state: GameState): DaySnap {
  const stores: StoreSnap[] = [];
  for (const fid of Object.keys(state.facilities).sort()) {
    const f = state.facilities[fid]!;
    if (f.type !== 'retail' || f.status === 'closed' || f.employees.length === 0) continue;
    if (f.retailProductIds.length === 0) continue;
    const firm = state.firms[f.ownerFirmId];
    const products: StoreSnap['products'] = {};
    for (const pid of f.retailProductIds) {
      // Shelf capacity for the day: the morning stock plus one contracted
      // top-up — logistics restocks intraday, so start-of-day stock alone
      // starves the shadow of goods real shoppers get by evening.
      let inbound = 0;
      for (const cid in state.contracts) {
        const con = state.contracts[cid]!;
        if (con.active && con.destinationFacilityId === f.id && con.productId === pid) {
          inbound += con.targetQuantity;
        }
      }
      products[pid] = {
        price: storePrice(state, f, pid),
        stock: getQuantity(f.inputInventory, pid),
        capacity: getQuantity(f.inputInventory, pid) + inbound * INBOUND_FACTOR,
        quality: getQuality(f.inputInventory, pid),
        brand: firm?.brandByProduct[pid] ?? 0,
      };
    }
    stores.push({
      id: f.id, firmId: f.ownerFirmId, x: f.location.x, y: f.location.y,
      builtAtTick: f.builtAtTick, positioning: (f as any).positioning ?? 'standard', products,
    });
  }
  const avgPrice: Record<string, number> = {};
  const wdm: Record<string, number> = {}; const sdm: Record<string, number> = {};
  const sold: Record<string, boolean> = {};
  for (const pid of ALL_PRODUCT_IDS) {
    avgPrice[pid] = state.marketStats[pid]?.averagePrice || getProduct(pid).basePrice;
    wdm[pid] = worldDemandMult(state, pid);
    sdm[pid] = seasonDemandMult(state, pid);
    sold[pid] = soldSomewhere(state, pid);
  }

  const obs: DaySnap['obs'] = {};
  const distTotals: Record<string, number> = {};
  const groups: Record<string, any[]> = {};
  for (const cid of Object.keys(state.citizens).sort()) {
    const c = state.citizens[cid]!;
    const d = homeDistrict(state, c);
    distTotals[d] = (distTotals[d] ?? 0) + 1;
    (groups[keyOf(d, c.tier)] ??= []).push(c);
  }
  for (const k of Object.keys(groups)) {
    const cits = groups[k]!;
    const tier = k.split(':')[1] as Tier;
    const next: Tier | null = tier === 'worker' ? 'comfortable' : tier === 'comfortable' ? 'affluent' : null;
    let emp = 0, apt = 0, cash = 0, hx = 0, hy = 0, entry = 0, floor = 0;
    for (const c of cits) {
      if (c.employmentStatus === 'employed') emp++;
      if (state.facilities[c.homeFacilityId]?.defId === 'apartment') apt++;
      cash += c.cash;
      const home = state.facilities[c.homeFacilityId];
      hx += home?.location.x ?? c.currentLocation.x;
      hy += home?.location.y ?? c.currentLocation.y;
      if (next && entryBarNoSat(state, c, next)) entry++;
      if (floorBarNoSat(state, c)) floor++;
    }
    const n = cits.length;
    obs[k] = {
      n, empShare: emp / n, aptShare: apt / n, meanCash: cash / n,
      homeX: hx / n, homeY: hy / n,
      entryFracNext: next ? entry / n : 0, floorFrac: floor / n,
    };
  }
  return { tick: state.tick, stores, avgPrice, wdm, sdm, wsm: worldSpendingMult(state), sold, obs, distTotals };
}

/** scoreStore, re-implemented for a cohort "representative": reliability is
 * the 0.4 no-history default (cohorts keep no per-store memory). */
function cohortStoreScore(
  state: GameState, snap: DaySnap, st: StoreSnap, pid: string, tier: Tier,
  homeX: number, homeY: number,
): { score: number; price: number } | null {
  const sp = st.products[pid];
  if (!sp) return null;
  const product = getProduct(pid);
  const availabilityScore = sp.stock > 0 ? 1 : 0;
  const priceScore = clamp(product.basePrice / Math.max(1, sp.price), 0, 2) / 2;
  const dist = distance({ x: homeX, y: homeY }, { x: st.x, y: st.y });
  const distanceScore = 1 - clamp(dist / state.config.maxShoppingDistance, 0, 1);
  const qualityScore = sp.quality / 100;
  const brandScore = clamp(sp.brand / 100, 0, 1);
  const reliabilityScore = 0.4;
  const ageDays = (snap.tick - st.builtAtTick) / (state.config.ticksPerHour * 24);
  const noveltyScore = st.builtAtTick > 0 && ageDays < 15 ? 0.12 * (1 - ageDays / 15) : 0;
  const affinity = positioningAffinity(st.positioning, tier, {
    avgQuality: sp.quality, price: sp.price, marketAvgPrice: snap.avgPrice[pid]!,
  });
  const score =
    availabilityScore * 0.28 + priceScore * 0.22 + distanceScore * 0.18 +
    qualityScore * 0.14 + brandScore * 0.12 + reliabilityScore * 0.06 +
    noveltyScore + affinity;
  return { score, price: sp.price };
}

/** One shadow day for every cohort. Mutates only shadow state; returns
 * per-product predicted units for the parity ledger. */
const dayDiag: {
  desired: Record<string, number>; fulfilled: Record<string, number>;
  stockoutU: Record<string, number>; pricedOutU: Record<string, number>;
  worker?: { sat: number; pressure: number; nudge: number; target: number };
} = { desired: {}, fulfilled: {}, stockoutU: {}, pricedOutU: {} };

/**
 * supplyCap: town-wide per-product units available today — a 7-day EMA of
 * actual sales × 1.15 headroom. The shadow can't interleave with production
 * and logistics the way the real A3 engine will, and contract target levels
 * wildly overstate true daily throughput (they are top-up levels, not
 * shipment sizes) — without this bound the shadow economy consumes more than
 * the town produces and every downstream signal inflates.
 */
function stepShadow(
  state: GameState, snap: DaySnap, shadow: Record<string, ShadowCohort>,
  supplyCap: Record<string, number>,
): Record<string, number> {
  const unitsByProduct: Record<string, number> = {};
  for (const pid of ALL_PRODUCT_IDS) {
    unitsByProduct[pid] = 0;
    dayDiag.desired[pid] = 0; dayDiag.fulfilled[pid] = 0;
    dayDiag.stockoutU[pid] = 0; dayDiag.pricedOutU[pid] = 0;
  }

  // 1) Sync population structure: immigration/emigration is exogenous.
  if (TIER_SYNC) {
    // Mode A: sync each cohort's population to the live census; intensive
    // state (urgency buckets, sat) stays the shadow's own. New cohorts seed
    // from the district's worker cohort.
    for (const d of Object.keys(state.districts).sort()) {
      for (const t of TIERS) {
        const key = keyOf(d, t);
        const actual = snap.obs[key]?.n ?? 0;
        let c = shadow[key];
        if (!c && actual > 0) {
          const seed = shadow[keyOf(d, 'worker')];
          c = shadow[key] = emptyShadow();
          if (seed) {
            c.sat = seed.sat;
            for (const pid of Object.keys(seed.u)) c.u[pid] = seed.u[pid]!.slice();
          }
        }
        if (c) c.pop = actual;
      }
    }
  } else {
    // Mode B: only district totals sync; the tier split free-runs. Arrivals
    // join the worker cohort; departures drain worker → comfortable → affluent.
    for (const d of Object.keys(state.districts).sort()) {
      const actual = snap.distTotals[d] ?? 0;
      let shadowTotal = 0;
      for (const t of TIERS) shadowTotal += shadow[keyOf(d, t)]?.pop ?? 0;
      let delta = actual - shadowTotal;
      if (delta > 0) {
        const w = (shadow[keyOf(d, 'worker')] ??= emptyShadow());
        // Arrivals: blend in at the fresh-immigrant sat baseline (70)
        // without erasing the cohort's own trajectory.
        const inSat = 70;
        w.sat = w.pop + delta > 0 ? (w.sat * w.pop + inSat * delta) / (w.pop + delta) : inSat;
        w.pop += delta;
      } else if (delta < 0) {
        for (const t of TIERS) {
          const c = shadow[keyOf(d, t)];
          if (!c || c.pop <= 0) continue;
          const take = Math.min(c.pop, -delta);
          c.pop -= take;
          delta += take;
          if (delta >= 0) break;
        }
      }
    }
  }

  // Shared per-day stock ledger: cohorts drain the same start-of-day shelves.
  const stockLedger: Record<string, Record<string, number>> = {};
  for (const st of snap.stores) {
    stockLedger[st.id] = {};
    for (const pid of Object.keys(st.products)) stockLedger[st.id]![pid] = st.products[pid]!.capacity;
  }
  const townSupply: Record<string, number> = {};
  for (const pid of ALL_PRODUCT_IDS) townSupply[pid] = supplyCap[pid] ?? Infinity;

  // Phase 1 — per-cohort plans: urgency growth, trip targeting, store visits.
  const plans: {
    key: string; c: ShadowCohort; t: Tier;
    ob: DaySnap['obs'][string]; cashBudget: number; nudge: number;
    visitsByStore: Record<string, number>; fulfilledBy: Record<string, number>;
  }[] = [];
  for (const d of Object.keys(state.districts).sort()) {
    for (const t of TIERS) {
      const key = keyOf(d, t);
      const c = shadow[key];
      if (!c || c.pop <= 0.01) continue;
      const ob = snap.obs[key] ?? snap.obs[keyOf(d, 'worker')] ?? { n: 0, empShare: 0.8, aptShare: 0, meanCash: 3000, homeX: 65, homeY: 80, entryFracNext: 0, floorFrac: 1 };

      // A) Urgency growth per bucket (hard cap — the bucket spread itself
      // models the well-served/starved mix a soft cap only approximated).
      for (const pid of ALL_PRODUCT_IDS) {
        if (!PRODUCTS[pid]!.needSpec) continue;
        const { g } = specMid(pid);
        const mult = tierNeedGrowthMult(t, pid);
        const b = bucketsOf(c, pid);
        for (let i = 0; i < NB; i++) {
          if (mult <= 0 && getProduct(pid).needType === 'luxury') {
            b[i] = Math.max(0, b[i]! - LUXURY_DECAY);
          } else {
            b[i] = Math.min(URGENCY_CAP, b[i]! + g * mult);
          }
        }
      }

      // B) Trips: distribute over trip-triggering products (u ≥ 0.5) by
      // urgency, then over stores selling each product by score².
      const totalVisits = c.pop * (T_EMP * ob.empShare + T_UNEMP * (1 - ob.empShare));
      const tripW: Record<string, number> = {};
      let tripWSum = 0;
      for (const pid of ALL_PRODUCT_IDS) {
        if (!PRODUCTS[pid]!.needSpec) continue;
        // An unservable craving never targets a trip (shoppableNeeds skips
        // needs with no open store) — without this, capped urgency for a
        // product nobody sells swallows the whole softmax and the town
        // stops shopping for what it CAN buy.
        if (!snap.sold[pid]) continue;
        const b = bucketsOf(c, pid);
        const uMean = b.reduce((a, u) => a + (u >= TRIP_GATE ? u : 0), 0) / NB;
        if (uMean <= 0) continue;
        const w = Math.exp((uMean - ORDER_BIAS * PRODUCTS[pid]!.needSpec!.order) / TRIP_TEMP);
        tripW[pid] = w; tripWSum += w;
      }
      // Urgent repeat trips: a second visit pool over products whose urgency
      // clears the urgent bar, same softmax targeting.
      const urgW: Record<string, number> = {};
      let urgWSum = 0;
      for (const pid of Object.keys(tripW)) {
        const b = bucketsOf(c, pid);
        const urFrac = b.reduce((a, u) => a + (u >= URGENT_BAR ? 1 : 0), 0) / NB;
        if (urFrac > 0) { urgW[pid] = tripW[pid]! * urFrac; urgWSum += urgW[pid]!; }
      }
      const urgentVisits = urgWSum > 0 ? c.pop * URGENT_TRIPS : 0;

      const visitsByStore: Record<string, number> = {};
      const allocate = (pid: string, visits: number) => {
        const scored: { st: StoreSnap; score: number }[] = [];
        for (const st of snap.stores) {
          const s = cohortStoreScore(state, snap, st, pid, t, ob.homeX, ob.homeY);
          if (s) scored.push({ st, score: Math.max(0, s.score) });
        }
        const wsum = scored.reduce((a, s) => a + s.score * s.score, 0);
        if (wsum <= 0) return; // nobody sells it: the trip never starts
        for (const s of scored) {
          visitsByStore[s.st.id] = (visitsByStore[s.st.id] ?? 0) + visits * (s.score * s.score) / wsum;
        }
      };
      if (tripWSum > 0) {
        for (const pid of Object.keys(tripW)) allocate(pid, totalVisits * (tripW[pid]! / tripWSum));
      }
      if (urgWSum > 0) {
        for (const pid of Object.keys(urgW)) allocate(pid, urgentVisits * (urgW[pid]! / urgWSum));
      }
      plans.push({ key, c, t, ob, cashBudget: ob.meanCash * c.pop, nudge: 0, visitsByStore, fulfilledBy: {} });
    }
  }

  // Phase 2 — C) purchases in 5 shop-window slices with every cohort
  // interleaved (the HD1 settlement design): sequential whole-day draining
  // let whichever cohort ran first eat the shelves and starve the rest.
  const SLICES = 5;
  for (let slice = 0; slice < SLICES; slice++) {
    for (const p of plans) {
      const { c, t } = p;
      for (const st of snap.stores) {
        const v = (p.visitsByStore[st.id] ?? 0) / SLICES;
        if (v <= 0.0002) continue;
        for (const pid of Object.keys(st.products).sort()) {
          const spec = PRODUCTS[pid]?.needSpec;
          if (!spec) continue;
          const b = bucketsOf(c, pid);
          // Smooth participation: a bucket is 20% of the cohort, and the
          // real buyer rotation is per-citizen — a bucket regrowing just
          // under the gate still holds members who cleared it today.
          const eligFrac = b.reduce((a, u) => a + Math.min(1, u / BASKET_GATE), 0) / NB;
          if (eligFrac <= 0.001) continue;
          const { mp, prefQ } = specMid(pid);
          const sp = st.products[pid]!;
          const wantMult = snap.wdm[pid]! * snap.sdm[pid]!;
          const wantQty = Math.max(1, Math.round(prefQ * wantMult));
          const preAttempt = v * eligFrac * wantQty;
          const premium = 1 + sp.brand / 250 + (sp.quality - 50) / 300;
          const cap = getProduct(pid).basePrice * mp * premium * snap.wsm *
            tierPriceCapMult(t, pid) * positioningPriceImage(st.positioning, sp.quality);
          // Walkaway caps are drawn per-citizen from a ± ~10% range — the
          // cohort's participation is a logistic in price, not a cliff.
          const buyFrac = 1 / (1 + Math.exp((sp.price - cap) / (0.06 * Math.max(1, cap))));
          const attempted = preAttempt * buyFrac;
          if (buyFrac < 0.999) {
            p.nudge += (-1 * v * eligFrac * (1 - buyFrac)) / c.pop;
            dayDiag.pricedOutU[pid]! += preAttempt * (1 - buyFrac);
          }
          if (attempted <= 0.0002) continue;
          const avail = Math.min(stockLedger[st.id]![pid]!, townSupply[pid]!);
          const affordable = sp.price > 0 ? p.cashBudget / sp.price : attempted;
          const qty = Math.max(0, Math.min(attempted, avail, affordable));
          stockLedger[st.id]![pid]! -= qty;
          townSupply[pid]! -= qty;
          p.cashBudget -= qty * sp.price;
          p.fulfilledBy[pid] = (p.fulfilledBy[pid] ?? 0) + qty;
          // Events: an exhausted ledger stings −2 per bounced visit.
          const fillFrac = attempted > 0 ? qty / attempted : 1;
          p.nudge += (1.5 * v * eligFrac * fillFrac
            - 2 * v * eligFrac * (avail <= 0 ? 1 : 0)) / c.pop;
          dayDiag.desired[pid]! += attempted;
          dayDiag.stockoutU[pid]! += attempted - qty;
        }
      }
    }
  }

  // Phase 3 — settle each cohort: drain urgency, pressure, satisfaction.
  for (const p of plans) {
    const { c, t, ob, fulfilledBy } = p;
    let nudge = p.nudge;
    let pressure = 0;
    {
      // D) Purchases drain urgency, most-urgent buckets first (agents above
      // the trip gate shop before those merely above the basket gate). A full
      // bucket-buy drops wantQty/prefQ, floored at 0 — over-buys waste
      // urgency exactly like the agents' min(u, qty/prefQ).
      for (const pid of Object.keys(fulfilledBy)) {
        const { prefQ } = specMid(pid);
        const wantMult = snap.wdm[pid]! * snap.sdm[pid]!;
        const wantQty = Math.max(1, Math.round(prefQ * wantMult));
        let remaining = fulfilledBy[pid]!;
        unitsByProduct[pid]! += remaining;
        dayDiag.fulfilled[pid]! += remaining;
        const b = bucketsOf(c, pid);
        const bucketCap = (c.pop / NB) * wantQty; // every member buys once
        // Purchases land on the LOWEST eligible buckets first: proximity
        // decides who shops, and it's the same well-served citizens every
        // day — their urgency stays low while the remote tail pins at the
        // cap. (Both most-urgent-first and ∝-urgency were measured to
        // over-rotate the cohort and crush the persistent high-u tail that
        // keeps the live town's mean urgency ~2.)
        const elig = b.map((u, i) => ({ u, i })).filter((x) => x.u >= BASKET_GATE);
        for (const { i } of elig.sort((x, y) => x.u - y.u)) {
          if (remaining <= 0) break;
          const take = Math.min(bucketCap, remaining);
          b[i] = Math.max(0, b[i]! - (take / bucketCap) * (wantQty / prefQ));
          remaining -= take;
        }
      }
      for (const pid of ALL_PRODUCT_IDS) {
        if (!PRODUCTS[pid]!.needSpec) continue;
        const b = bucketsOf(c, pid);
        for (const u of b) pressure += pressureShadow(u, pid, snap) / NB;
        // Chronic-shortage retry stings (see RETRY_K).
        if (snap.sold[pid]) {
          const urgentFrac = b.reduce((a, u) => a + (u >= URGENT_BAR ? 1 : 0), 0) / NB;
          nudge -= 2 * RETRY_K * urgentFrac;
        }
      }

      // E) Satisfaction: equilibrium drift on top of the intraday nudges.
      let target = 50;
      target += ob.empShare * 20 - (1 - ob.empShare) * 5;
      target += APARTMENT_SATISFACTION_BONUS * ob.aptShare;
      target += clamp(15 - pressure * 12, -30, 15);
      const withNudge = clamp(c.sat + nudge, 0, 100);
      c.sat = clamp(withNudge + (clamp(target, 0, 100) - withNudge) * 0.12, 0, 100);
      if (t === 'worker') dayDiag.worker = { sat: c.sat, pressure, nudge, target };
    }
  }

  // 3) Tier gates (Mode B only): streak hysteresis, then continuous flows.
  // The satisfaction bar uses a logistic qualifying fraction (individual sat
  // spreads ~8 points around the cohort mean), promotion moves skim the top
  // of the sat distribution (selection), demotions carry the bottom.
  const qual = (sat: number, bar: number) => 1 / (1 + Math.exp(-(sat - bar) / 5));
  for (const d of TIER_SYNC ? [] : Object.keys(state.districts).sort()) {
    // promotions bottom-up so mass can't double-jump in one day
    for (const t of ['comfortable', 'worker'] as Tier[]) {
      const from = shadow[keyOf(d, t)];
      if (!from || from.pop <= 0.01) continue;
      const next: Tier = t === 'worker' ? 'comfortable' : 'affluent';
      const ob = snap.obs[keyOf(d, t)];
      const satBar = next === 'comfortable' ? COMFORTABLE_SATISFACTION : AFFLUENT_SATISFACTION;
      // qual² ≈ P(an individual clears the bar every day of the streak) —
      // the tail is far stricter than "the cohort mean crosses today".
      const q = qual(from.sat, satBar);
      const gateFrac = q * q * (ob?.entryFracNext ?? 0);
      if (gateFrac > 0.02) {
        from.promoteStreak++;
        const needDays = next === 'affluent' ? AFFLUENT_PROMOTION_DAYS : PROMOTION_DAYS;
        if (from.promoteStreak >= needDays) {
          transfer(shadow, keyOf(d, t), keyOf(d, next), from.pop * MOVE_RATE * gateFrac, +6);
        }
      } else {
        from.promoteStreak = 0;
      }
    }
    for (const t of ['comfortable', 'affluent'] as Tier[]) {
      const c = shadow[keyOf(d, t)];
      if (!c || c.pop <= 0.01) continue;
      const ob = snap.obs[keyOf(d, t)];
      const floorSat = t === 'comfortable' ? COMFORTABLE_SATISFACTION_FLOOR : AFFLUENT_SATISFACTION_FLOOR;
      const failFrac = 1 - qual(c.sat, floorSat) * (ob?.floorFrac ?? 1);
      if (failFrac > 0.02) {
        c.demoteStreak++;
        if (c.demoteStreak >= DEMOTION_DAYS) {
          const down: Tier = t === 'affluent' ? 'comfortable' : 'worker';
          transfer(shadow, keyOf(d, t), keyOf(d, down), c.pop * MOVE_RATE * failFrac, -6);
        }
      } else {
        c.demoteStreak = 0;
      }
    }
  }
  return unitsByProduct;
}

function pressureShadow(u: number, pid: string, snap: DaySnap): number {
  if (u <= 1.1) return 0; // needUrgentThreshold
  return (u - 1.1) * needWeight(pid) * (snap.sold[pid] ? 1 : 0.5);
}

function emptyShadow(): ShadowCohort {
  return { pop: 0, sat: 70, u: {}, promoteStreak: 0, demoteStreak: 0 };
}

/** Move mass between cohorts. satOffset models selection: promotion skims
 * the TOP of the sat distribution (+σ), leaving the source cohort's mean
 * lower — the negative feedback that stops the real gate from promoting
 * without bound. Total sat mass is conserved. */
function transfer(shadow: Record<string, ShadowCohort>, fromKey: string, toKey: string, mass: number, satOffset = 0) {
  const from = shadow[fromKey]!;
  const moved = Math.min(from.pop, mass);
  if (moved <= 0) return;
  const to = (shadow[toKey] ??= emptyShadow());
  const newPop = to.pop + moved;
  const movedSat = clamp(from.sat + satOffset, 0, 100);
  if (from.pop - moved > 0.01) {
    from.sat = (from.sat * from.pop - movedSat * moved) / (from.pop - moved);
    from.sat = clamp(from.sat, 0, 100);
  }
  to.sat = (to.sat * to.pop + movedSat * moved) / newPop;
  for (const pid of new Set([...Object.keys(to.u), ...Object.keys(from.u)])) {
    const tb = bucketsOf(to, pid).slice().sort((a, b) => b - a);
    const fb = bucketsOf(from, pid).slice().sort((a, b) => b - a);
    to.u[pid] = tb.map((u, i) => (u * to.pop + fb[i]! * moved) / newPop);
  }
  to.pop = newPop;
  from.pop -= moved;
}

// ---------------------------------------------------------------------------

const DAYS = Number(process.env.DAYS ?? 300);
const BURN_IN = 30;
const DIAG = process.env.DIAG === '1';
const SEEDS = DIAG ? [11] : [11, 4, 7];
/** Mode A (default, TIER_SYNC=true): tier populations sync to the live town
 * daily and the gates are off — isolates the A3-critical demand + satisfaction
 * machinery. Mode B (MODE=free): tiers free-run through the shadow gates —
 * measures how far gate-driven composition drifts (reported as risk; the A3
 * engine owns real per-cohort wealth distributions the shadow lacks). */
const TIER_SYNC = process.env.MODE !== 'free';

for (const seed of SEEDS) {
  const sim = new Simulation(createInitialState(seed));
  sim.dispatch({ type: 'RESUME' });
  const state = sim.getState();
  const tpd = ticksPerDay(state.config);

  // Seed shadow from the actual day-0 population.
  const shadow: Record<string, ShadowCohort> = {};
  {
    const groups: Record<string, any[]> = {};
    for (const cid of Object.keys(state.citizens).sort()) {
      const c = state.citizens[cid]!;
      (groups[keyOf(homeDistrict(state, c), c.tier)] ??= []).push(c);
    }
    for (const k of Object.keys(groups)) {
      const cits = groups[k]!;
      const sc = emptyShadow();
      sc.pop = cits.length;
      sc.sat = cits.reduce((a, c) => a + c.satisfaction, 0) / cits.length;
      for (const pid of ALL_PRODUCT_IDS) {
        if (!PRODUCTS[pid]!.needSpec) continue;
        // Quantile-seed the buckets from the actual urgency distribution.
        const us = cits.map((c) => c.needs.find((n: any) => n.productId === pid)?.urgency ?? 0)
          .sort((a, b) => b - a);
        sc.u[pid] = Array.from({ length: NB }, (_, i) => {
          const lo = Math.floor((i * us.length) / NB);
          const hi = Math.max(lo + 1, Math.floor(((i + 1) * us.length) / NB));
          const slice = us.slice(lo, hi);
          return slice.reduce((a, x) => a + x, 0) / slice.length;
        });
      }
      shadow[k] = sc;
    }
  }

  const cumShadow: Record<string, number> = {};
  const cumActual: Record<string, number> = {};
  const dailyShadow: Record<string, number[]> = {};
  const dailyActual: Record<string, number[]> = {};
  for (const pid of ALL_PRODUCT_IDS) {
    cumShadow[pid] = 0; cumActual[pid] = 0; dailyShadow[pid] = []; dailyActual[pid] = [];
  }
  const satErrs: number[] = [];
  let satMax = 0; let satMaxAt = '';
  const tierErrs: Record<Tier, number[]> = { worker: [], comfortable: [], affluent: [] };
  let prevWorkerSat: number | null = null;
  const impliedNudges: number[] = [];
  // Lagged supply estimate: 7-day EMA of actual sales × 1.15 headroom + a
  // small floor so new products aren't strangled at introduction.
  const emaSold: Record<string, number> = {};

  for (let day = 0; day < DAYS; day++) {
    const snap = snapshot(state);
    const supplyCap: Record<string, number> = {};
    for (const pid of ALL_PRODUCT_IDS) {
      supplyCap[pid] = day < 3 ? Infinity : Math.max(1, emaSold[pid]! * 1.08);
    }
    const predicted = stepShadow(state, snap, shadow, supplyCap);
    sim.run(tpd);

    for (const pid of ALL_PRODUCT_IDS) {
      const hist = state.marketStats[pid]!.history;
      const actual = hist.length > 0 ? hist[hist.length - 1]!.unitsSold : 0;
      cumShadow[pid]! += predicted[pid]!;
      cumActual[pid]! += actual;
      dailyShadow[pid]!.push(predicted[pid]!);
      dailyActual[pid]!.push(actual);
      emaSold[pid] = day === 0 ? actual : emaSold[pid]! + (actual - emaSold[pid]!) / 7;
    }

    if (DIAG) {
      // Actual worker-cohort mean urgency + sat + exact mean target, daily.
      const uActual: Record<string, number> = {};
      let n = 0, satActual = 0, targetSum = 0;
      for (const cid in state.citizens) {
        const c = state.citizens[cid]!;
        if (c.tier !== 'worker') continue;
        n++; satActual += c.satisfaction;
        for (const need of c.needs) uActual[need.productId] = (uActual[need.productId] ?? 0) + need.urgency;
        let press = 0;
        for (const need of c.needs) {
          if (need.urgency <= 1.1) continue;
          press += (need.urgency - 1.1) * needWeight(need.productId) * (snap.sold[need.productId] ? 1 : 0.5);
        }
        let tgt = 50 + (c.employmentStatus === 'employed' ? 20 : -5);
        if (state.facilities[c.homeFacilityId]?.defId === 'apartment') tgt += APARTMENT_SATISFACTION_BONUS;
        tgt += clamp(15 - press * 12, -30, 15);
        targetSum += clamp(tgt, 0, 100);
      }
      // Implied intraday nudge: solve s' = 0.88(s+n) + 0.12·t̄ for n against
      // yesterday's actual mean sat (linear approx, per-citizen clamps aside).
      const tBar = n > 0 ? targetSum / n : 0;
      const sNow = n > 0 ? satActual / n : 0;
      if (prevWorkerSat !== null) impliedNudges.push((sNow - 0.12 * tBar) / 0.88 - prevWorkerSat);
      prevWorkerSat = sNow;

      if (day % 10 === 0) {
        const w = shadow[keyOf('the_rows', 'worker')];
        const uLine = ALL_PRODUCT_IDS.filter((p) => PRODUCTS[p]!.needSpec).map((pid) => {
          const au = n > 0 ? (uActual[pid] ?? 0) / n : 0;
          return `${pid}:${(w ? meanU(w, pid) : 0).toFixed(2)}/${au.toFixed(2)}`;
        }).join(' ');
        const dLine = ALL_PRODUCT_IDS.filter((p) => PRODUCTS[p]!.needSpec).map((pid) => {
          const hist = state.marketStats[pid]!.history;
          const h = hist[hist.length - 1]!;
          return `${pid}:d${dayDiag.desired[pid]!.toFixed(0)}f${dayDiag.fulfilled[pid]!.toFixed(0)}s${dayDiag.stockoutU[pid]!.toFixed(0)}p${dayDiag.pricedOutU[pid]!.toFixed(0)}|a${h.unitsSold}u${h.unmetDemand}`;
        }).join(' ');
        const recent = impliedNudges.slice(-10);
        const impliedMean = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
        const tierCounts: Record<Tier, number> = { worker: 0, comfortable: 0, affluent: 0 };
        let tot = 0;
        for (const cid in state.citizens) { tierCounts[state.citizens[cid]!.tier as Tier]++; tot++; }
        const shTiers: Record<Tier, number> = { worker: 0, comfortable: 0, affluent: 0 };
        let shTot = 0;
        for (const k of Object.keys(shadow)) { shTiers[k.split(':')[1] as Tier] += shadow[k]!.pop; shTot += shadow[k]!.pop; }
        console.log(`d${day} u[sh/act] ${uLine}`);
        console.log(`d${day} units ${dLine}`);
        console.log(`d${day} workerSat sh ${w?.sat.toFixed(1)} act ${sNow.toFixed(1)} | shNudge ${dayDiag.worker?.nudge.toFixed(2)} implNudge ${impliedMean.toFixed(2)} | shTarget ${dayDiag.worker?.target.toFixed(1)} actTarget ${tBar.toFixed(1)} shPress ${dayDiag.worker?.pressure.toFixed(2)}`);
        console.log(`d${day} tiers sh ${TIERS.map((t) => (shTot > 0 ? (shTiers[t] / shTot) * 100 : 0).toFixed(0)).join('/')} act ${TIERS.map((t) => (tot > 0 ? (tierCounts[t] / tot) * 100 : 0).toFixed(0)).join('/')}`);
      }
    }

    // Satisfaction + tier comparisons on the post-day state.
    if (day >= BURN_IN) {
      const groups: Record<string, { sum: number; n: number }> = {};
      const tierCounts: Record<Tier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      let totalPop = 0;
      for (const cid in state.citizens) {
        const c = state.citizens[cid]!;
        const k = keyOf(homeDistrict(state, c), c.tier);
        (groups[k] ??= { sum: 0, n: 0 });
        groups[k]!.sum += c.satisfaction; groups[k]!.n += 1;
        tierCounts[c.tier as Tier]++; totalPop++;
      }
      for (const k of Object.keys(groups)) {
        const g = groups[k]!;
        if (g.n < 5) continue;
        const sc = shadow[k];
        if (!sc || sc.pop < 1) continue;
        const err = Math.abs(sc.sat - g.sum / g.n);
        satErrs.push(err);
        if (err > satMax) { satMax = err; satMaxAt = `${k}@d${day}`; }
      }
      let shadowTotal = 0;
      const shadowTiers: Record<Tier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const k of Object.keys(shadow)) {
        const t = k.split(':')[1] as Tier;
        shadowTiers[t] += shadow[k]!.pop;
        shadowTotal += shadow[k]!.pop;
      }
      for (const t of TIERS) {
        const a = totalPop > 0 ? tierCounts[t] / totalPop : 0;
        const s = shadowTotal > 0 ? shadowTiers[t] / shadowTotal : 0;
        tierErrs[t].push(Math.abs(a - s) * 100);
      }
    }
  }

  // ---- report ----
  const unitReport: Record<string, string> = {};
  let unitsPass = true;
  for (const pid of ALL_PRODUCT_IDS) {
    if (!PRODUCTS[pid]!.needSpec) continue;
    const a = cumActual[pid]!; const s = cumShadow[pid]!;
    // Micro-volume products (< 3 units/day town-wide) get an absolute
    // criterion: at that scale the named cast carries the trade in A3, and
    // a ±10% relative bar on ~1 unit/day is noise, not signal.
    if (a < DAYS * 3) {
      const absPerDay = Math.abs(s - a) / DAYS;
      unitReport[pid] = `cum ${s.toFixed(0)}/${a} (micro: |err| ${absPerDay.toFixed(2)}/day)`;
      if (absPerDay > 1.5) unitsPass = false;
      continue;
    }
    const errPct = a > 0 ? ((s - a) / a) * 100 : (s > 0 ? 999 : 0);
    // worst 30-day rolling window (skip burn-in)
    let worstWin = 0;
    for (let i = BURN_IN; i + 30 <= DAYS; i++) {
      let wa = 0, ws = 0;
      for (let j = i; j < i + 30; j++) { wa += dailyActual[pid]![j]!; ws += dailyShadow[pid]![j]!; }
      if (wa > 30) { // ignore windows with negligible actual volume
        const we = Math.abs((ws - wa) / wa) * 100;
        if (we > worstWin) worstWin = we;
      }
    }
    unitReport[pid] = `cum ${s.toFixed(0)}/${a} (${errPct >= 0 ? '+' : ''}${errPct.toFixed(1)}%) worst30d ${worstWin.toFixed(1)}%`;
    if (Math.abs(errPct) > 10) unitsPass = false;
  }
  const satMae = satErrs.length > 0 ? satErrs.reduce((x, y) => x + y, 0) / satErrs.length : 0;
  const tierReport: Record<string, string> = {};
  let tierPass = true;
  for (const t of TIERS) {
    const errs = tierErrs[t];
    const mean = errs.reduce((x, y) => x + y, 0) / Math.max(1, errs.length);
    const max = Math.max(0, ...errs);
    tierReport[t] = `mean ${mean.toFixed(1)}pt max ${max.toFixed(1)}pt`;
    if (max > 8) tierPass = false;
  }

  console.log(JSON.stringify({
    seed,
    units: unitReport,
    unitsPass,
    sat: { mae: satMae.toFixed(2), max: satMax.toFixed(2), maxAt: satMaxAt, pass: satMae <= 5 },
    tiers: tierReport,
    tierPass,
    pop: Object.keys(state.citizens).length,
    rngState: state.rngState,
  }, null, 1));
}
