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
 *      streak moves 7%/day × qualifying-fraction of the block into the
 *      neighbouring tier, skimming ±6 satisfaction off the moved mass so the
 *      gate self-limits (promotion removes the happiest; demotion the least).
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
import { cohortAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import type { Cohort } from '../entities/Cohort';
import { NEED_BUCKETS, emptyCohort, cohortId } from '../entities/Cohort';
import type { CitizenTier } from '../entities/Citizen';
import { clamp } from '../../utils/clamp';
import { dollars } from '../data/constants';
import { SIZE_PRESETS } from '../core/SimulationConfig';
import { needWeight, soldSomewhere } from './SatisfactionSystem';
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
/** Streak holds while the qualifying (or failing) fraction clears this floor. */
const GATE_HOLD_FRAC = 0.02;
/** Selection skim: a promotion carries off the top of the satisfaction
 * distribution (+σ), a demotion the bottom (−σ), so the gate self-limits. */
const SAT_SKIM = 6;

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

/** Migration rates at cohort scale (starting values, to pin against soaks). */
const INFLOW_RATE = 0.004;
const OUTFLOW_RATE = 0.003;
/** Each arrival brings this much cash from the world account — the same
 * per-capita the seedCrowd bootstrap and cast immigration use. */
const ARRIVAL_CASH_PER_CAPITA = dollars(50);

const ORDER: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

function anyCrowd(state: GameState): boolean {
  for (const cid in state.cohorts) {
    if (state.cohorts[cid]!.population > 0) return true;
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

  // Which needSpec products some staffed store sells today — a craving nobody
  // can satisfy hurts half as much (mirrors SatisfactionSystem.pressureOf).
  const soldCache: Record<string, boolean> = {};

  // Snapshot the id list before the gates mint new tier cohorts.
  const cohortIds = Object.keys(state.cohorts).sort();
  const facilityIds = Object.keys(state.facilities).sort();

  // --- a. satisfaction ----------------------------------------------------
  for (const cid of cohortIds) {
    updateSatisfaction(ctx, state.cohorts[cid]!, soldCache);
  }

  // --- b. tier gates ------------------------------------------------------
  for (const cid of cohortIds) {
    runTierGates(state, ctx.config.subsistenceIncomePerDay, state.cohorts[cid]!, facilityIds);
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
  // NEED_BUCKETS, and left un-renormalized against today's basket (baseline 1).
  let pressure = 0;
  for (const pid of Object.keys(cohort.needBuckets).sort()) {
    const b = cohort.needBuckets[pid]!;
    if (soldCache[pid] === undefined) soldCache[pid] = soldSomewhere(state, pid);
    const sellerFactor = soldCache[pid] ? 1 : 0.5;
    const w = needWeight(pid);
    let sum = 0;
    for (let i = 0; i < NEED_BUCKETS; i++) {
      const over = b[i]! - config.needUrgentThreshold;
      if (over > 0) sum += over * w * sellerFactor;
    }
    pressure += sum / NEED_BUCKETS;
  }

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
 * qualFrac = logistic((sat − satBar)/5)² × max(wageFrac, savingsOk), the square
 * encoding the probe's tail strictness (an individual must clear the bar every
 * day of the streak, not on average). Demotion mirrors it with a fail fraction.
 * A matured streak moves 7%/day × the (qualifying|failing) fraction.
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
    const wageBar = sub * (toAffluent ? AFFLUENT_WAGE_MULT : COMFORTABLE_WAGE_MULT);
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
    // (city soak: comfortable ran 53-70% vs the 25-40 band).
    const savingsFrac = clamp((perCapitaSavings - savingsBar) / savingsBar, 0, 1);
    const satTerm = logistic((cohort.avgSatisfaction - satBar) / 5);
    const qualFrac = satTerm * satTerm * Math.max(wageFrac, savingsFrac);

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
    const holdFactor = Math.max(wageFloorFrac, savingsFloorFrac);
    const failFrac = 1 - logistic((cohort.avgSatisfaction - satFloorBar) / 5) * holdFactor;

    if (failFrac > GATE_HOLD_FRAC) {
      cohort.gateStreaks.demote += 1;
      if (cohort.gateStreaks.demote >= DEMOTION_DAYS) {
        const move = Math.floor(pop * TIER_FLOW_RATE * failFrac);
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

  const destId = cohortId(source.districtId, targetTier);
  let dest = state.cohorts[destId];
  if (!dest) {
    dest = emptyCohort(source.districtId, targetTier);
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
  for (const cid in state.cohorts) {
    const co = state.cohorts[cid]!;
    satMass += co.avgSatisfaction * co.population;
    headcount += co.population;
    totalCrowd += co.population;
  }
  const townAvg = headcount > 0 ? satMass / headcount : 0;

  // Inflow to worker cohorts while the town is attractive and there is room.
  if (townAvg >= IMMIGRATION_MIN_SATISFACTION) {
    for (const cid of cohortIds) {
      const cohort = state.cohorts[cid];
      if (!cohort || cohort.tier !== 'worker' || cohort.population <= 0) continue;
      const room = cap - totalCrowd;
      if (room <= 0) break;
      const desirability = state.districts[cohort.districtId]?.desirability ?? 0;
      let inflow = Math.floor(cohort.population * INFLOW_RATE * (0.5 + desirability));
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
    const cohort = state.cohorts[cid];
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
