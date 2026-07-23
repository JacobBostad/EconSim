/**
 * CastCuratorSystem — the cast stays a faithful sample of the crowd (Arc A3,
 * slice 4). Design principle 3 in docs/design/cohorts-and-districts.md.
 *
 * The named ~150 are meant to be a representative sample of the whole
 * population, not a separate little town: their demographics should track the
 * crowd's. As the crowd shifts — a district fills, a tier swells — the cast
 * drifts out of proportion, so a daily curator nudges one citizen back toward
 * the mark.
 *
 * The target is a LARGEST-REMAINDER apportionment of the cast across
 * district × tier strata by (cast + crowd) population: every stratum gets
 * floor(quota) seats, then the largest fractional remainders round up until the
 * seats sum to the current cast size. The curator never grows or shrinks the
 * cast (SIZE_PRESETS castTarget growth is ImmigrationSystem's job) — each day it
 * performs at most ONE swap: retire one citizen from the most over-represented
 * stratum into the crowd, and promote one crowd member into the most
 * under-represented stratum. One out, one in: the cast size is invariant.
 *
 * Hysteresis: a swap fires only when some stratum is over by >= 2 seats AND
 * another is under by >= 2. One-seat drift never churns a life — the same
 * instinct as the tier-change streaks.
 *
 * Village dark: a town with no crowd (Village preset) never has an
 * over/under-represented stratum backed by crowd mass, but we exit on the
 * anyCrowd guard before any of this — zero new state-mutating code paths, and
 * critically zero shared-rng draws (see the promote note below).
 */

import type { SimContext, GameState } from '../core/GameState';
import { emitEvent, recordTransaction } from '../core/GameState';
import { townOf } from '../core/Town';
import { cohortAccount, citizenAccount } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import type { Citizen, CitizenTier } from '../entities/Citizen';
import type { Vec2 } from '../entities/Location';
import { districtAt } from '../entities/District';
import type { DistrictId } from '../entities/District';
import { emptyCohort } from '../entities/Cohort';
import { createFacility, createCitizen } from '../entities/factories';
import { removeCitizen } from './LaborSystem';
import { homeSlotFor, HOME_SLOT_SPEC } from './ImmigrationSystem';
import { firstFreeDistrictSlot } from '../core/DistrictSlots';

/** Hysteresis band: a stratum must be off by at least this many seats before a
 * swap disturbs it (one-seat drift is noise, not a signal). */
const REBALANCE_HYSTERESIS = 2;

/** The prosperity tiers, in a fixed order so strata enumerate deterministically. */
const TIERS: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

function anyCrowd(state: GameState): boolean {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohorts = townOf(state).cohorts;
  for (const cid in cohorts) {
    if (cohorts[cid]!.population > 0) return true;
  }
  return false;
}

/** The stratum a home location + tier belongs to, as `${districtId}:${tier}`.
 * Bare-`state` helper mid-gradient: reads the home town by default (one-town
 * region → identical reference); gains a `townId` param at the endgame move. */
function stratumOf(state: GameState, home: Vec2, tier: CitizenTier): string {
  const d = districtAt(townOf(state).districts, home.x, home.y);
  return `${d ? d.id : ''}:${tier}`;
}

interface Stratum {
  key: string;
  districtId: DistrictId;
  tier: CitizenTier;
}

/** Most swaps the curator will perform in a single day. One swap/day was the
 * A3 slice-4 pace, and it holds while cast tier mobility is slow. But a faithful-
 * sample town has REAL churn — once RetailDemandSystem's worker catch-up lets the
 * city cast provision like the crowd, cast workers promote out of the worker
 * tier at the crowd's rate (many/day across districts), and a single swap/day
 * falls behind: the soak measured one stratum drifting to 20+ off its
 * apportionment. The curator now drains the backlog each day — it keeps swapping
 * while SOME stratum is over by >= 2 and another under by >= 2, up to this cap.
 * When the cast already sits within the hysteresis band (the pre-catch-up
 * equilibrium, and every Village) the first census finds no qualifying pair and
 * the loop makes ZERO swaps — identical to the old one-swap path, so no extra
 * rng is ever drawn in a balanced town. */
const MAX_SWAPS_PER_DAY = 8;

export function runCastCuratorSystem(ctx: SimContext): void {
  const { state } = ctx;
  // Village stays dark: no crowd means no stratum can be crowd-backed, and no
  // shared-rng draw ever happens here.
  if (!anyCrowd(state)) return;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  for (let i = 0; i < MAX_SWAPS_PER_DAY; i++) {
    if (!curate(ctx)) break;
  }
}

/** Perform at most one over→under swap; returns true iff a swap happened (so
 * the daily loop can keep draining a backlog until the strata are balanced). */
function curate(ctx: SimContext): boolean {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);

  // --- census: cast + crowd per district × tier stratum ---
  const strata: Stratum[] = [];
  for (const did of Object.keys(town.districts).sort()) {
    for (const tier of TIERS) strata.push({ key: `${did}:${tier}`, districtId: did, tier });
  }
  const castCount: Record<string, number> = {};
  const pop: Record<string, number> = {};
  for (const s of strata) {
    castCount[s.key] = 0;
    pop[s.key] = 0;
  }
  let castTotal = 0;
  for (const cid of Object.keys(town.citizens).sort()) {
    const c = town.citizens[cid]!;
    const home = town.facilities[c.homeFacilityId];
    if (!home) continue;
    const key = stratumOf(state, home.location, c.tier);
    if (castCount[key] === undefined) continue; // stratum outside the partition
    castCount[key] += 1;
    castTotal += 1;
  }
  let totalPop = castTotal;
  for (const s of strata) {
    const crowd = town.cohorts[s.key]?.population ?? 0;
    pop[s.key] = castCount[s.key]! + crowd;
    totalPop += crowd;
  }
  if (castTotal === 0 || totalPop === 0) return false;

  // --- largest-remainder apportionment of the cast over the strata ---
  const seats: Record<string, number> = {};
  const remainders: { key: string; rem: number }[] = [];
  let assigned = 0;
  for (const s of strata) {
    const raw = (castTotal * pop[s.key]!) / totalPop;
    const floor = Math.floor(raw);
    seats[s.key] = floor;
    assigned += floor;
    remainders.push({ key: s.key, rem: raw - floor });
  }
  // Hand the leftover seats to the largest fractional remainders; ties break to
  // the lexicographically smaller stratum key so the result is deterministic.
  remainders.sort((a, b) => b.rem - a.rem || (a.key < b.key ? -1 : 1));
  for (let i = 0; i < castTotal - assigned && i < remainders.length; i++) {
    const key = remainders[i]!.key;
    seats[key] = seats[key]! + 1;
  }

  // --- most over- / under-represented strata (first stratum wins ties) ---
  let over: Stratum | null = null;
  let overBy = 0;
  let under: Stratum | null = null;
  let underBy = 0;
  for (const s of strata) {
    const diff = castCount[s.key]! - seats[s.key]!;
    if (diff > overBy) {
      overBy = diff;
      over = s;
    }
    if (-diff > underBy) {
      underBy = -diff;
      under = s;
    }
  }
  if (!over || !under || overBy < REBALANCE_HYSTERESIS || underBy < REBALANCE_HYSTERESIS) return false;

  // The under-represented stratum only qualifies when crowd mass backs it (a
  // stratum with no crowd can never have a target above its cast count), so a
  // promotion source always exists — but guard anyway; if either half of the
  // swap can't happen, we skip BOTH so the cast size stays invariant.
  const source = town.cohorts[under.key];
  if (!source || source.population <= 0) return false;
  const gone = pickRetiree(state, over);
  if (!gone) return false;
  const homeId = resolvePromoteHome(ctx, under.districtId, gone);
  if (homeId === null) return false;

  retire(ctx, gone, over);
  promote(ctx, under, source, homeId);
  return true;
}

/**
 * The most suitable citizen to retire from an over-represented stratum:
 * unemployed first (they give up the least by joining the anonymous crowd),
 * then whoever holds the least cash (the crowd pools savings, so a thin wallet
 * is the softest landing), with the lowest citizen id breaking exact ties for
 * determinism. Sorted-id iteration makes the tie-break fall out for free.
 */
function pickRetiree(state: GameState, over: Stratum): Citizen | null {
  let pick: Citizen | null = null;
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const town = townOf(state);
  const citizens = town.citizens;
  for (const cid of Object.keys(citizens).sort()) {
    const c = citizens[cid]!;
    const home = town.facilities[c.homeFacilityId];
    if (!home) continue;
    if (stratumOf(state, home.location, c.tier) !== over.key) continue;
    if (pick === null) {
      pick = c;
      continue;
    }
    const cJobless = c.employmentStatus === 'unemployed';
    const pickJobless = pick.employmentStatus === 'unemployed';
    if (cJobless !== pickJobless) {
      if (cJobless) pick = c;
      continue;
    }
    if (c.cash < pick.cash) pick = c;
  }
  return pick;
}

/**
 * Where a promoted citizen would live in the target district, WITHOUT mutating
 * anything — resolved before the swap so retire and promote are atomic. Prefers
 * the retiree's own home (it frees a slot in the same district, which is the
 * common case while districts are metadata over one residential band), then any
 * in-district home with room, then a freshly built home. Null when the district
 * genuinely cannot house another citizen — in which case the whole swap is
 * abandoned rather than shrinking the cast.
 */
function resolvePromoteHome(ctx: SimContext, districtId: DistrictId, gone: Citizen): string | null {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const inDistrict = (loc: Vec2): boolean =>
    districtAt(town.districts, loc.x, loc.y)?.id === districtId;

  const goneHome = town.facilities[gone.homeFacilityId];
  if (goneHome && inDistrict(goneHome.location)) return gone.homeFacilityId;

  let homes = 0;
  let existing: string | null = null;
  for (const fid of Object.keys(town.facilities).sort()) {
    const f = town.facilities[fid]!;
    if (f.type !== 'home') continue;
    homes += 1;
    if (existing === null && f.residentIds.length < 2 && inDistrict(f.location)) existing = fid;
  }
  if (existing !== null) return existing;

  if (homes < ctx.config.maxHomes) {
    // Village keeps the legacy column-march coordinates (bit-identity); big
    // maps enumerate a free slot INSIDE the target district — homeSlotFor
    // only ever yields the map's west half, so on 260/390-wide maps it can
    // never satisfy an east-district promotion and the swap would silently
    // die (A4 review finding).
    const slot =
      ctx.config.sizePreset === 'village'
        ? homeSlotFor(Math.max(0, homes - 20), ctx.config.mapHeight)
        : firstFreeDistrictSlot(ctx.state, 'residential', HOME_SLOT_SPEC, [], districtId);
    if (slot && inDistrict(slot)) {
      const home = createFacility(state, 'home', state.worldFirmId, slot, { name: `Home ${homes + 1}` });
      return home.id;
    }
  }
  return null;
}

/** Retire a cast member into the crowd of their stratum: settle their savings
 * into that cohort's pool and grow its head count by one. The comfortable and
 * affluent crowd cohorts are first seeded here — slice 4 is what populates the
 * non-worker crowd, so a stratum's cohort may not exist yet. */
function retire(ctx: SimContext, gone: Citizen, over: Stratum): void {
  const { state } = ctx;
  // Cohort CREATION site — a writer, kept on the flat path until records move
  // in option (c); the guard read + assign stay on `state.cohorts`.
  let cohort = state.cohorts[over.key];
  if (!cohort) {
    cohort = emptyCohort(over.districtId, over.tier, state.config.sizePreset);
    state.cohorts[over.key] = cohort;
  }
  const name = gone.name;
  const districtName = townOf(state, ctx.townId).districts[over.districtId]?.name ?? over.districtId;
  // Shared removal path — cash flows citizen -> cohort pool, conserved.
  removeCitizen(state, gone, cohortAccount(over.key), `Retired ${name} into the crowd`);
  cohort.population += 1;
  emitEvent(
    state,
    'info',
    'economy',
    `🧳 ${name} settled into the crowd of ${districtName}, trading the spotlight for a quieter life.`,
    null,
  );
}

/**
 * Promote one crowd member into the cast at the target stratum's tier. The
 * newcomer is drawn from the anonymous crowd — so cohort.employed stays
 * consistent because the crowd's idle hands are what fill cast vacancies (clamp
 * guards the corner where a fully-employed cohort loses a head). They arrive
 * unemployed; LaborSystem hires them the ordinary way next day.
 *
 * CRITICAL DETERMINISM NOTE: createCitizen draws names, preferences, needs, and
 * skill from the SHARED sim rng. That is the ONE place cohort curation touches
 * the shared stream, and it is acceptable ONLY because it happens exclusively
 * in crowd towns (this whole system is gated by anyCrowd) — a Village town has
 * no crowd, never reaches a qualifying swap, and never draws here, so the
 * Village stream stays bit-identical. Do not lift this guard.
 */
function promote(
  ctx: SimContext,
  under: Stratum,
  source: { id: string; cashPool: number; population: number; employed: number },
  homeId: string,
): void {
  const { state } = ctx;
  const share = Math.floor(source.cashPool / source.population);
  const cit = createCitizen(state, ctx.rng, homeId);
  cit.tier = under.tier;
  cit.tierStreak = 0;
  source.population -= 1;
  if (source.employed > source.population) source.employed = source.population;
  if (share > 0) {
    recordTransaction(state, {
      from: cohortAccount(source.id),
      to: citizenAccount(cit.id),
      amount: share,
      firmId: null,
      category: 'none',
      note: `Promoted ${cit.name} from the crowd`,
    });
  }
  const districtName = townOf(state, ctx.townId).districts[under.districtId]?.name ?? under.districtId;
  emitEvent(
    state,
    'success',
    'economy',
    `✨ ${cit.name} stepped out of ${districtName}'s crowd into a life of their own.`,
    cit.id,
  );
}
