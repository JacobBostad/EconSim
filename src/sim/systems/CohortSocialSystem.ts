/**
 * CohortSocialSystem — the crowd's satisfaction, tier mobility, and migration
 * (Arc A3, slice 3).
 *
 * The social counterpart of the cast's SatisfactionSystem + TierSystem +
 * ImmigrationSystem, run once per day over the cohorts after the cast ladder
 * has landed. Three passes, each in sorted-key order:
 *
 *   a. SATISFACTION — the same equilibrium-drift formula the cast follows
 *      (employment share + bucket-summed unmet-need pressure, drifting at the
 *      0.12 rate), plus the probe-verified intraday purchase / stockout /
 *      priced-out nudges booked by CohortDemandSystem into `cohort.dayEvents`.
 *
 *   b. TIER GATES — promotion (worker→comfortable→affluent) and demotion,
 *      reusing the TierSystem wage/satisfaction/savings bars but evaluated
 *      against the COHORT'S OWN wealth signals (its members' wages, its own
 *      per-capita cash, its own satisfaction) — never observed-agent means,
 *      which the shadow-parity probe measured diverge without bound. A matured
 *      streak moves the qualifying-fraction of the block into the neighbouring
 *      tier — promotion at 7%/day, demotion at 2× that (the over-tier is also
 *      re-seeded daily by the cast curator, an inflow promotion lacks) — skimming
 *      ±6 satisfaction off the moved mass so the gate self-limits (promotion
 *      removes the happiest; demotion the least).
 *
 *   c. MIGRATION — inflow to worker cohorts when the town clears the
 *      immigration bar (∝ district desirability, capped by the size preset's
 *      cohort cap), outflow from any cohort mired below the emigration bar.
 *
 * Zero rng draws — every rule is a pure function of state. A town with no crowd
 * (Village preset) exits before touching anything, so Village stays
 * bit-identical.
 */

import type { SimContext, GameState } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { townOf } from '../core/Town';
import { cohortAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import type { Cohort } from '../entities/Cohort';
import { NEED_BUCKETS, emptyCohort, cohortId } from '../entities/Cohort';
import type { CitizenTier } from '../entities/Citizen';
import { clamp } from '../../utils/clamp';
import { dollars } from '../data/constants';
import { SIZE_PRESETS } from '../core/SimulationConfig';
import { needWeight, soldSomewhere, BASKET_WEIGHT_BASELINE } from './SatisfactionSystem';
import {
  COMFORTABLE_WAGE_MULT,
  COMFORTABLE_WAGE_FLOOR_MULT,
  AFFLUENT_WAGE_MULT,
  AFFLUENT_WAGE_FLOOR_MULT,
  COMFORTABLE_SATISFACTION,
  COMFORTABLE_SATISFACTION_FLOOR,
  AFFLUENT_SATISFACTION,
  AFFLUENT_SATISFACTION_FLOOR,
  COMFORT_SAVINGS_CENTS,
  COMFORT_SAVINGS_FLOOR_CENTS,
  AFFLUENT_WEALTH_CENTS,
  AFFLUENT_WEALTH_FLOOR_CENTS,
  PROMOTION_DAYS,
  AFFLUENT_PROMOTION_DAYS,
  DEMOTION_DAYS,
  tierNeedGrowthMult,
} from './TierSystem';
import {
  IMMIGRATION_MIN_SATISFACTION,
  EMIGRATION_MAX_SATISFACTION,
} from '../data/constants';

// --- probe-calibrated constants (see the tier-gate section of the shadow-
// parity verdict in docs/design/cohorts-and-districts.md) -------------------

/** Satisfaction drifts toward its equilibrium at this rate — the cast's rate. */
const DRIFT_RATE = 0.12;

/** Continuous tier flow once a streak matures: the 7%/day midpoint of the
 * probe's measured 6-8%/day band, times the qualifying fraction of the block. */
const TIER_FLOW_RATE = 0.07;

/**
 * Demotion flows 2× faster than promotion. Promotion is a lone cohort gate, but
 * the over-tier is ALSO re-seeded every day by the cast curator's backlog drain
 * — CastCuratorSystem retires over-represented cast comfortable/affluent members
 * straight into the matching cohort (up to MAX_SWAPS_PER_DAY = 8/day), an inflow
 * promotion has no counterpart to. The combined economy makes this bite: the
 * worker catch-up over-provisions cast workers, they promote through the cast
 * TierSystem, and the curator dumps the surplus into the crowd's comfortable
 * cohort. A SYMMETRIC 7% demotion cannot clear that extra inflow and comfortable
 * pins in the 50s (joint soak: 54/83/45% against the 25-40 band; with the cohort
 * promotion gate forced to `qualFrac = 0` comfortable STILL sat at 48% — proof
 * the gate is not the driver, the curator re-seed is). Demotion at 2× lands the
 * comfortable band (45-day mean) at 32/32/39% on seeds 11/4/7, worker 66/66/59,
 * with the worker cast-vs-cohort gap at 1.3/3.5/3.3.
 *
 * Swept against the 300-day × 3-seed bands: 2.0× centers all three in 25-40;
 * 1.9× and 2.1× each let the (large) seed-to-seed variance push one town's
 * comfortable just over 40, and 2.2× over-demotes the noisiest seed's crowd
 * worker cohort enough to blow its cast-vs-cohort gap past 12. The gates are a
 * chaotic curator↔demotion oscillation, so a single day's share swings ±6; the
 * band is a multi-week mean, measured deterministically at day 300.
 */
const DEMOTION_FLOW_RATE = TIER_FLOW_RATE * 2.0;
/** Streak holds while the qualifying (or failing) fraction clears this floor. */
const GATE_HOLD_FRAC = 0.02;
/** Selection skim: a promotion carries off the top of the satisfaction
 * distribution (+σ), a demotion the bottom (−σ), so the gate self-limits. */
const SAT_SKIM = 6;

/**
 * The savings route is a MARGINAL substitute for wages, not a wholesale one.
 * Cohort pro-rata tier moves equalize per-capita pools across tiers (a
 * promotion carries a slice of the source pool into the dest, so the pool
 * tracks the town, not the class), so once the town is cash-rich EVERY tier's
 * float-adjusted savings clears the cast bars and the proportional savings leg
 * pins to 1 — the pool stops discriminating tiers (joint-calibration soak:
 * comfortable ran 54/83/45% against the 25-40 band, an idle 34%-employed block
 * held whole by its pool). Capping the savings leg at this share forces the
 * WAGE and SATISFACTION legs to carry the tier discrimination the equalized
 * pool cannot: savings can lift (or shield) at most half a block on its own;
 * the rest must be earning the tier. Swept against the 300-day × 3-seed bands
 * — 0.5 lands worker/comfortable in 50-70 / 25-40 on all three seeds; higher
 * re-inflates comfortable (the idle block re-coasts on its pool), lower
 * over-demotes the genuinely-saving districts below the comfortable band.
 */
const SAVINGS_ROUTE_CAP = 0.5;

/**
 * The crowd's WORKING FLOAT — the cash that cycles through daily rent + shopping,
 * which a cohort's shared pool carries alongside any real savings. A citizen at
 * $250 has a nest egg; a cohort at $250/capita may be holding one week of the
 * block's spending money. The savings-route tier gate subtracts this float
 * before comparing per-capita cash to the cast savings bars, so the signal reads
 * genuine savings, not turnover: a district's pool has to clear a week-plus of
 * living costs before its cash counts toward promotion, and a poor district
 * whose pool is only float-deep reads $0 savings (never spuriously promoting).
 *
 * Pinned from the city soak: crowd throughput measured $17-19/capita/day (rent
 * ~$2-3 under the affordability cap + shopping ~$16, spend-measure probe at
 * day 280 across seeds 11/4/7), and an ~8-day earn→spend horizon — the liquidity
 * a daily-paid, daily-shopping household keeps on hand — pins the float at $140.
 * (The 30-day figure in the original design note assumed ~$3/day of shopping;
 * the live crowd spends ~5× that, so the horizon, not the daily rate, is what
 * keeps the float a working buffer rather than a month of consumption.) The
 * horizon was swept against the 300-day × 3-seed tier bands: $140 lands worker
 * and comfortable inside 50-70 / 25-40 on all three seeds (higher over-taxes the
 * savings route and strands the poorest town below the comfortable band; lower
 * lets the pool drift back through the bar and re-gentrifies the richer towns).
 */
const FLOAT_RESERVE_CENTS = 140_00;

/**
 * Migration rates at cohort scale. OUTFLOW is the A3 starting value. INFLOW was
 * RE-PINNED from 0.004 to 0.002 in the A4 geometry recalibration (docs/design/
 * cohorts-and-districts.md, "A4 geometry recalibration").
 *
 * The immigration gate reads only town SATISFACTION (≥ 55), never job supply, so
 * a satisfied-but-jobless town keeps attracting worker households — and inflow is
 * proportional to the worker cohort's own population, so it COMPOUNDS. On the
 * 130×92 A3 City the crowd stayed roughly proportionate to the jobs the firms
 * could staff; on the 260×184 A4 map the same 0.004 floods the worker tier faster
 * than founders add jobs (crowd 472 vs ~155 jobs at day 300), so worker
 * employment share collapses to ~0.20. That cratered empShare quadratically
 * throttles the promotion gate (qualFrac ∝ satTerm²·wageFrac·empShare, and
 * wageFrac ≤ empShare, so ∝ empShare²) AND drives the demotion holdFactor down
 * (an idle over-tier is demoted at 2×), pushing the whole gate system into a
 * chaotic, bistable regime — measured worker 74-82 / comfortable 16-25 against
 * the 50-70 / 25-40 bands, with the same constants landing one seed at 60/37 and
 * another at 92/6.
 *
 * Halving the rate breaks the compounding so the crowd stays proportionate to
 * jobs (worker empShare ~0.27-0.40): the gates return to the stable regime the A3
 * calibration was tuned for, and worker/comfortable seat in-band on all three
 * seeds. The effect is a PLATEAU, not a knife-edge — immigration barely fires
 * once the flood stops (town avg sat sits near the 55 bar), so 0.4×, 0.5×, and
 * 0.6× the base rate give BIT-IDENTICAL 300-day outcomes; the plateau breaks
 * upward at ~0.7× (immigration resumes, seed-7 comfortable falls back to 16).
 * 0.002 sits mid-plateau. Cohort-gated (runMigration is behind the anyCrowd
 * guard), so Village is untouched.
 */
const INFLOW_RATE = 0.002;
const OUTFLOW_RATE = 0.003;
/** Each arrival brings this much cash from the world account — the same
 * per-capita the seedCrowd bootstrap and cast immigration use. */
const ARRIVAL_CASH_PER_CAPITA = dollars(50);

const ORDER: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

function anyCrowd(state: GameState): boolean {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohorts = townOf(state).cohorts;
  for (const cid in cohorts) {
    if (cohorts[cid]!.population > 0) return true;
  }
  return false;
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function runCohortSocialSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!anyCrowd(state)) return;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const town = townOf(state, ctx.townId);

  // Which needSpec products some staffed store sells today — a craving nobody
  // can satisfy hurts half as much (mirrors SatisfactionSystem.pressureOf).
  const soldCache: Record<string, boolean> = {};

  // Snapshot the id list before the gates mint new tier cohorts.
  const cohortIds = Object.keys(town.cohorts).sort();
  const facilityIds = Object.keys(state.facilities).sort();

  // --- a. satisfaction ----------------------------------------------------
  for (const cid of cohortIds) {
    updateSatisfaction(ctx, town.cohorts[cid]!, soldCache);
  }

  // --- b. tier gates ------------------------------------------------------
  for (const cid of cohortIds) {
    runTierGates(state, ctx.config.subsistenceIncomePerDay, town.cohorts[cid]!, facilityIds);
  }

  // --- c. migration -------------------------------------------------------
  runMigration(state, cohortIds);
}

/**
 * The SatisfactionSystem equilibrium formula, per cohort: an employment-share
 * target dragged down by bucket-summed unmet-need pressure, drifted toward at
 * the 0.12 rate, with the day's booked purchase / stockout / priced-out
 * shopper-events nudging intraday. The crowd does not rent, so there is no
 * apartment term. The accumulator is reset once folded in.
 */
function updateSatisfaction(ctx: SimContext, cohort: Cohort, soldCache: Record<string, boolean>): void {
  const { state, config } = ctx;
  const pop = cohort.population;
  if (pop <= 0) {
    cohort.dayEvents = { fulfilled: 0, unmet: 0, pricedOut: 0 };
    return;
  }
  const empShare = cohort.employed / pop;

  // Unmet-need pressure summed over the urgency buckets (convex in urgency, so
  // buckets read the persistent tail a mean would miss). Averaged over the
  // NEED_BUCKETS.
  let pressure = 0;
  let basketW = 0;
  for (const pid of Object.keys(cohort.needBuckets).sort()) {
    const b = cohort.needBuckets[pid]!;
    if (soldCache[pid] === undefined) soldCache[pid] = soldSomewhere(state, pid);
    const sellerFactor = soldCache[pid] ? 1 : 0.5;
    const w = needWeight(pid);
    // Basket weight this tier actually wants — the denominator of the same A1
    // renormalization the cast applies (SatisfactionSystem.basketNormalization).
    if (tierNeedGrowthMult(cohort.tier, pid) > 0) basketW += w;
    let sum = 0;
    for (let i = 0; i < NEED_BUCKETS; i++) {
      const over = b[i]! - config.needUrgentThreshold;
      if (over > 0) sum += over * w * sellerFactor;
    }
    pressure += sum / NEED_BUCKETS;
  }
  // Renormalize against the tier's basket exactly as the cast does (A1): a
  // broader catalog REDISTRIBUTES the crowd's unmet-need exposure instead of
  // stacking unbounded satisfaction drag as products are added. Provably inert
  // for the CITY crowd — its basket is the base catalog (the C1 breadth is
  // metropolis-only), and every base tier's wanted basket sums to <=
  // BASKET_WEIGHT_BASELINE (3.2), so the factor is exactly 1 and the pinned city
  // tier calibration is untouched. It engages only for the METROPOLIS crowd,
  // whose basket carries the C1 breadth past the baseline. Village never runs
  // this system.
  if (basketW > BASKET_WEIGHT_BASELINE) pressure *= BASKET_WEIGHT_BASELINE / basketW;

  let target = 50 + 20 * empShare - 5 * (1 - empShare);
  target += clamp(15 - pressure * 12, -30, 15);

  const ev = cohort.dayEvents;
  const nudge = (1.5 * ev.fulfilled - 2 * ev.unmet - 1 * ev.pricedOut) / pop;
  const withNudge = cohort.avgSatisfaction + nudge;
  cohort.avgSatisfaction = clamp(
    withNudge + (clamp(target, 0, 100) - withNudge) * DRIFT_RATE,
    0,
    100,
  );

  cohort.dayEvents = { fulfilled: 0, unmet: 0, pricedOut: 0 };
}

/**
 * Promotion and demotion gates evaluated on the cohort's OWN signals. Promotion
 * qualFrac = logistic((sat − satBar)/5)² × max(wageFrac, cappedSavings) ×
 * empShare — the square encodes the probe's tail strictness (clear the bar every
 * day of the streak, not on average), the savings cap keeps the equalized pool
 * from gentrifying a block on cash it isn't earning, and the empShare weight
 * keeps a mostly-idle block from promoting on a saturated wage bar (see the
 * joint-calibration note on SAVINGS_ROUTE_CAP / DEMOTION_FLOW_RATE). Demotion
 * mirrors it with a fail fraction. A matured promotion streak moves TIER_FLOW_
 * RATE/day × qualFrac; demotion moves DEMOTION_FLOW_RATE (2×)/day × failFrac,
 * the asymmetry clearing the cast curator's daily re-seed of the over-tier.
 */
function runTierGates(
  state: GameState,
  sub: number,
  cohort: Cohort,
  facilityIds: string[],
): void {
  const pop = cohort.population;
  if (pop <= 0) return;
  const idx = ORDER.indexOf(cohort.tier);
  const empShare = cohort.employed / pop;
  const perCapitaCash = cohort.cashPool / pop;
  // Genuine savings = per-capita cash above the working float (daily rent +
  // shopping turnover the pool must carry). This is the cohort's nest-egg
  // signal; the raw pool is not, since it also holds the crowd's spending money.
  const perCapitaSavings = Math.max(0, perCapitaCash - FLOAT_RESERVE_CENTS);

  // Fraction of the block employed at a firm whose wage clears a given bar.
  const wageFracAtLeast = (wageBar: number): number => {
    let atOrAbove = 0;
    for (const fid of facilityIds) {
      const fac = state.facilities[fid]!;
      const n = fac.crowdByCohort[cohort.id] ?? 0;
      if (n <= 0) continue;
      const firm = state.firms[fac.ownerFirmId];
      if ((firm?.wagePolicy.baseWage ?? 0) >= wageBar) atOrAbove += n;
    }
    return atOrAbove / pop;
  };

  // --- promotion ---
  const nextTier = ORDER[idx + 1];
  let promoted = false;
  if (nextTier) {
    const toAffluent = nextTier === 'affluent';
    // Cent-round the promotion wage bar: `sub * (18/14)` carries a sub-cent float
    // tail (1800.0000000000002¢), so a founder paying exactly $18 (1800¢) would
    // NOT clear a raw `>=` compare. Rounding to the nearest cent lets the City
    // decoupling's $18 crowd wage clear the comfortable bar, and is provably inert
    // to every pinned run (no pinned firm pays inside the sub-cent gap). The
    // demotion FLOOR bar is left un-rounded on purpose (Metropolis's $16 crowd
    // sits a float epsilon under the $16 floor — rounding would flip that pin).
    const wageBar = Math.round(sub * (toAffluent ? AFFLUENT_WAGE_MULT : COMFORTABLE_WAGE_MULT));
    const satBar = toAffluent ? AFFLUENT_SATISFACTION : COMFORTABLE_SATISFACTION;
    const savingsBar = toAffluent ? AFFLUENT_WEALTH_CENTS : COMFORT_SAVINGS_CENTS;
    const needed = toAffluent ? AFFLUENT_PROMOTION_DAYS : PROMOTION_DAYS;

    const wageFrac = wageFracAtLeast(wageBar);
    // Proportional savings route: a cohort's per-capita mean is not a promise
    // every member holds the bar, so the savings LEG is the fraction by which
    // the block's genuine (float-adjusted) savings clears the bar — 0 at the
    // bar, saturating at 1 by twice the bar. The old binary `perCapita >= bar`
    // promoted the WHOLE block the day the mean crossed, which — with the pool
    // drifting past the bar for every district by mid-run — gentrified the town
    // (city soak: comfortable ran 53-70% vs the 25-40 band). The savings route
    // is now also capped to a marginal share (SAVINGS_ROUTE_CAP): the equalized
    // pool clears the bar for every tier by mid-run, so savings alone must not
    // gentrify a block — the wage leg carries the rest.
    const savingsFrac = clamp((perCapitaSavings - savingsBar) / savingsBar, 0, 1);
    const savingsLeg = Math.min(savingsFrac, SAVINGS_ROUTE_CAP);
    const satTerm = logistic((cohort.avgSatisfaction - satBar) / 5);
    // Employment-scaled promotion FLOW (joint calibration). The combined
    // economy's worker catch-up lifted firm wages until every employed worker
    // clears the comfortable wage bar (wf18 == empShare in the soak), so the
    // wage leg alone would advance the whole employed fraction — being jobbed at
    // $18/day is not the same as being a comfortable class. Weighting the
    // qualifier by empShare makes promotion read "a block genuinely earning its
    // way up": a 40%-employed district advances at a fraction of a fully-jobbed
    // one's rate.
    const qualFrac = satTerm * satTerm * Math.max(wageFrac, savingsLeg) * empShare;

    if (qualFrac > GATE_HOLD_FRAC) {
      cohort.gateStreaks.promote += 1;
      if (cohort.gateStreaks.promote >= needed) {
        const move = Math.floor(pop * TIER_FLOW_RATE * qualFrac);
        if (move > 0) {
          moveMass(state, cohort, nextTier, move, SAT_SKIM, facilityIds);
          promoted = true;
        }
      }
    } else {
      cohort.gateStreaks.promote = 0;
    }
  } else {
    cohort.gateStreaks.promote = 0;
  }

  // --- demotion (skip if promotion already moved mass this day) ---
  const prevTier = ORDER[idx - 1];
  if (prevTier && !promoted) {
    const isAffluent = cohort.tier === 'affluent';
    const wageFloorBar = sub * (isAffluent ? AFFLUENT_WAGE_FLOOR_MULT : COMFORTABLE_WAGE_FLOOR_MULT);
    const satFloorBar = isAffluent ? AFFLUENT_SATISFACTION_FLOOR : COMFORTABLE_SATISFACTION_FLOOR;
    const savingsFloorBar = isAffluent ? AFFLUENT_WEALTH_FLOOR_CENTS : COMFORT_SAVINGS_FLOOR_CENTS;

    const wageFloorFrac = wageFracAtLeast(wageFloorBar);
    // Proportional, float-adjusted savings floor (mirrors the promotion leg):
    // the fraction whose genuine savings still clears the demotion floor. A
    // block coasting on a pool that is mostly working float no longer holds its
    // whole tier by the savings leg — only the share genuinely above the floor.
    const savingsFloorFrac = clamp((perCapitaSavings - savingsFloorBar) / savingsFloorBar, 0, 1);
    // Demotion honesty: an unemployed member holds NO wage floor, and the
    // equalized pool must not shield an idle block wholesale. The savings hold
    // is both capped (SAVINGS_ROUTE_CAP) AND employment-weighted, so a mostly-
    // idle over-gentrified block (crowd employment runs ~30-50% at city scale)
    // is shielded only on its employment-scaled share; the genuinely-earning
    // fraction (wageFloorFrac) holds the rest. In the combined economy every
    // employed member clears the $16 floor, so wageFloorFrac ≈ empShare
    // dominates this max and the block's demotion pressure tracks its idle
    // share directly — the pool can no longer prop a jobless class up.
    const savingsShield = Math.min(savingsFloorFrac, SAVINGS_ROUTE_CAP) * empShare;
    const holdFactor = Math.max(wageFloorFrac, savingsShield);
    const failFrac = 1 - logistic((cohort.avgSatisfaction - satFloorBar) / 5) * holdFactor;

    if (failFrac > GATE_HOLD_FRAC) {
      cohort.gateStreaks.demote += 1;
      if (cohort.gateStreaks.demote >= DEMOTION_DAYS) {
        const move = Math.floor(pop * DEMOTION_FLOW_RATE * failFrac);
        if (move > 0) moveMass(state, cohort, prevTier, move, -SAT_SKIM, facilityIds);
      }
    } else {
      cohort.gateStreaks.demote = 0;
    }
  } else if (!prevTier) {
    cohort.gateStreaks.demote = 0;
  }
}

/**
 * Move `m` whole people from `source` into its district's `targetTier` cohort
 * (created if absent, carrying the source's appetite). Cash moves pro-rata via
 * a cohort→cohort transaction; employed workers move pro-rata by reassigning
 * facility crowd slots (whole workers, sorted facilities). The moved mass
 * carries avgSatisfaction + `satSkim`; both cohorts' means are recomputed as
 * mass-weighted averages so total satisfaction mass is conserved across the
 * transfer.
 */
function moveMass(
  state: GameState,
  source: Cohort,
  targetTier: CitizenTier,
  m: number,
  satSkim: number,
  facilityIds: string[],
): void {
  if (m <= 0 || m > source.population) m = Math.min(m, source.population);
  if (m <= 0) return;
  const popS = source.population;

  // Cohort CREATION site — a writer, kept on the flat path until records move
  // in option (c); the guard read + assign stay on `state.cohorts`.
  const destId = cohortId(source.districtId, targetTier);
  let dest = state.cohorts[destId];
  if (!dest) {
    dest = emptyCohort(source.districtId, targetTier, state.config.sizePreset);
    // The moved crowd keeps its cravings — copy the source's buckets rather
    // than starting the new tier at the seed baseline.
    dest.needBuckets = {};
    for (const pid of Object.keys(source.needBuckets).sort()) {
      dest.needBuckets[pid] = [...source.needBuckets[pid]!];
    }
    state.cohorts[destId] = dest;
  }

  // Satisfaction: conserve the total mass, letting the skim move satisfaction
  // between the two cohorts (a pure transfer — nothing minted).
  const popD = dest.population;
  const carried = clamp(source.avgSatisfaction + satSkim, 0, 100);
  const newPopS = popS - m;
  const newPopD = popD + m;
  if (newPopS > 0) {
    source.avgSatisfaction = clamp(
      (popS * source.avgSatisfaction - m * carried) / newPopS,
      0,
      100,
    );
  }
  dest.avgSatisfaction =
    newPopD > 0
      ? clamp((popD * dest.avgSatisfaction + m * carried) / newPopD, 0, 100)
      : dest.avgSatisfaction;

  // Cash: pro-rata slice of the source pool, through the money primitive.
  const cashMove = Math.floor(source.cashPool * (m / popS));
  if (cashMove > 0) {
    recordTransaction(state, {
      from: cohortAccount(source.id),
      to: cohortAccount(dest.id),
      amount: cashMove,
      firmId: null,
      category: 'none',
      note: `Cohort ${m} moved ${source.tier}->${targetTier}`,
    });
  }

  // Employment: reassign a pro-rata slice of the source's crowd slots to the
  // destination cohort, whole workers, sorted facilities.
  let workersToMove = Math.min(source.employed, Math.floor(source.employed * (m / popS)));
  let remaining = workersToMove;
  for (const fid of facilityIds) {
    if (remaining <= 0) break;
    const fac = state.facilities[fid]!;
    const n = fac.crowdByCohort[source.id] ?? 0;
    if (n <= 0) continue;
    const take = Math.min(n, remaining);
    fac.crowdByCohort[source.id] = n - take;
    if (fac.crowdByCohort[source.id]! <= 0) delete fac.crowdByCohort[source.id];
    fac.crowdByCohort[dest.id] = (fac.crowdByCohort[dest.id] ?? 0) + take;
    remaining -= take;
  }
  const moved = workersToMove - remaining;

  source.population = newPopS;
  dest.population = newPopD;
  source.employed = Math.min(newPopS, Math.max(0, source.employed - moved));
  dest.employed = Math.min(newPopD, dest.employed + moved);
}

/**
 * Migration at cohort scale. Inflow grows worker cohorts when the town's
 * (cast + crowd) average satisfaction clears the immigration bar, faster in
 * more desirable districts, capped so the whole crowd never exceeds the size
 * preset's cohort cap. Outflow drains any cohort stuck below the emigration
 * bar. Arrival/departure cash mirrors the cast: it flows to/from the world
 * account, so money supply is conserved.
 */
function runMigration(state: GameState, cohortIds: string[]): void {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const town = townOf(state);
  const cap = SIZE_PRESETS[state.config.sizePreset].cohortCap;

  // Town average satisfaction — the crowd is most of the town now, so the gate
  // reads a population-weighted mean over the cast AND the cohorts.
  let satMass = 0;
  let headcount = 0;
  for (const id in state.citizens) {
    satMass += state.citizens[id]!.satisfaction;
    headcount += 1;
  }
  let totalCrowd = 0;
  for (const cid in town.cohorts) {
    const co = town.cohorts[cid]!;
    satMass += co.avgSatisfaction * co.population;
    headcount += co.population;
    totalCrowd += co.population;
  }
  const townAvg = headcount > 0 ? satMass / headcount : 0;

  // Employment-aware immigration gate (City cast-parity pass). The satisfaction
  // gate below never reads job supply, so a well-served town floods its worker
  // cohort faster than founders add jobs and empShare craters — the wall the
  // cast-parity mechanism hit (closing the cast gap raises town satisfaction and
  // re-triggers the flood). When `immigrationEmpFloor` > 0, inflow is scaled by
  // the worker cohort's employment headroom above the floor, so immigration halts
  // when jobs are scarce and resumes as they fill. 0 = disabled = shipped gate.
  const empFloor = SIZE_PRESETS[state.config.sizePreset].immigrationEmpFloor;

  // Inflow to worker cohorts while the town is attractive and there is room.
  if (townAvg >= IMMIGRATION_MIN_SATISFACTION) {
    for (const cid of cohortIds) {
      const cohort = town.cohorts[cid];
      if (!cohort || cohort.tier !== 'worker' || cohort.population <= 0) continue;
      const room = cap - totalCrowd;
      if (room <= 0) break;
      const desirability = town.districts[cohort.districtId]?.desirability ?? 0;
      let inflow = Math.floor(cohort.population * INFLOW_RATE * (0.5 + desirability));
      if (empFloor > 0) {
        const empShare = cohort.population > 0 ? cohort.employed / cohort.population : 0;
        const jobFactor = clamp((empShare - empFloor) / (1 - empFloor), 0, 1);
        inflow = Math.floor(inflow * jobFactor);
      }
      inflow = Math.min(inflow, room);
      if (inflow <= 0) continue;
      cohort.population += inflow;
      totalCrowd += inflow;
      recordTransaction(state, {
        from: WORLD_ACCOUNT,
        to: cohortAccount(cohort.id),
        amount: inflow * ARRIVAL_CASH_PER_CAPITA,
        firmId: null,
        category: 'none',
        note: `Crowd arrivals (${inflow})`,
      });
    }
  }

  // Outflow: a cohort mired below the emigration bar loses households, their
  // per-capita savings leaving with them (clamp employment; CohortLaborSystem
  // reconciles the freed slots).
  for (const cid of cohortIds) {
    const cohort = town.cohorts[cid];
    if (!cohort || cohort.population <= 0) continue;
    if (cohort.avgSatisfaction >= EMIGRATION_MAX_SATISFACTION) continue;
    const leavers = Math.floor(cohort.population * OUTFLOW_RATE);
    if (leavers <= 0) continue;
    const perCapita = Math.floor(cohort.cashPool / cohort.population);
    cohort.population -= leavers;
    cohort.employed = Math.min(cohort.employed, cohort.population);
    const cashOut = leavers * perCapita;
    if (cashOut > 0) {
      recordTransaction(state, {
        from: cohortAccount(cohort.id),
        to: WORLD_ACCOUNT,
        amount: cashOut,
        firmId: null,
        category: 'none',
        note: `Crowd departures (${leavers})`,
      });
    }
  }
}
