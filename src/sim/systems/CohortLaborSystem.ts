/**
 * CohortLaborSystem — the crowd goes to work (Arc A3).
 *
 * Daily (after the cast job market): reconcile crowd staffing. Anonymous
 * cohort workers fill the slots the named cast leaves open, up to each
 * facility's workerCapacity, bounded by the owner's ability to carry the
 * wage bill. The cast always has priority — when a citizen takes a slot at
 * an over-full facility, crowd workers yield.
 *
 * Every tick during work hours: crowd workers count toward
 * `facility.presentWorkers` / `presentSkill` (at their cohort's avgSkill),
 * which is all ProductionSystem needs — no production change required.
 *
 * Zero rng draws; sorted iteration throughout; a town with no crowd
 * (Village preset) exits before touching anything.
 */

import type { SimContext, GameState } from '../core/GameState';
import { townOf, HOME_TOWN_ID, type TownId } from '../core/Town';
import { isDayBoundary } from '../core/Tick';
import { crowdCount } from '../entities/Facility';
import { isWorkTime } from './CitizenScheduleSystem';

/** A firm hires crowd only while its cash covers this many days of the projected
 * wage bill — the same instinct the AI applies to cast hiring (Village never
 * reaches this code — no crowd). */
const CROWD_WAGE_BUFFER_DAYS = 7;

function anyCrowd(state: GameState, townId: TownId = HOME_TOWN_ID): boolean {
  // Town-scoped: reads THIS town's crowd (the scheduler passes ctx.townId so the
  // partner's guard checks the partner's cohorts). Home default keeps every
  // one-town caller byte-identical.
  const cohorts = townOf(state, townId).cohorts;
  for (const cid in cohorts) {
    if (cohorts[cid]!.population > 0) return true;
  }
  return false;
}

export function runCohortLaborSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!anyCrowd(state, ctx.townId)) return;
  const town = townOf(state, ctx.townId);

  if (isDayBoundary(state.tick, ctx.config)) reconcileCrowdJobs(state, ctx.townId);

  // Per-tick presence RESET for a CAST-LESS town (region.md step 4, slice 3). In
  // a town with a cast, LaborSystem owns this reset (it zeroes presentWorkers/
  // Skill each tick before the cast, then the crowd, add their presence). A
  // partner runs the light subset WITHOUT LaborSystem, so this system owns the
  // reset there — every tick, so an off-hours factory has no phantom night shift
  // (presentWorkers must be 0 when nobody is on the clock). Gated on an empty
  // cast, so a town WITH a cast is byte-identical (LaborSystem still owns it, and
  // this branch never runs). Without it, the partner's presentWorkers would
  // accumulate unbounded across ticks.
  if (Object.keys(town.citizens).length === 0) {
    for (const fid in town.facilities) {
      town.facilities[fid]!.presentWorkers = 0;
      town.facilities[fid]!.presentSkill = 0;
    }
  }

  // Crowd presence: cohort workers keep facility hours, not commutes.
  if (isWorkTime(ctx)) {
    for (const fid in town.facilities) {
      const fac = town.facilities[fid]!;
      for (const cid in fac.crowdByCohort) {
        const n = fac.crowdByCohort[cid]!;
        if (n <= 0) continue;
        const cohort = town.cohorts[cid];
        fac.presentWorkers += n;
        fac.presentSkill += n * (cohort?.avgSkill ?? 1);
      }
    }
  }
}

function reconcileCrowdJobs(state: GameState, townId: TownId = HOME_TOWN_ID): void {
  // Town-scoped (region.md step 4, slice 3): the scheduler passes ctx.townId so
  // the partner's crowd staffs the PARTNER's facilities and home's staffs home's
  // — the two reconciliations never touch each other's records. Home default is
  // byte-identical for every one-town caller.
  const town = townOf(state, townId);
  const cohorts = town.cohorts;
  const cohortIds = Object.keys(cohorts).sort();
  const facilityIds = Object.keys(town.facilities).sort();

  // Rebuild employment counts from assignments so they can never drift.
  const employedByCohort: Record<string, number> = {};
  for (const cid of cohortIds) employedByCohort[cid] = 0;

  // Pass 1 — evictions: closed/ineligible facilities lose their crowd, and
  // where the cast has grown into the capacity, crowd yields (largest
  // holdings first, id tiebreak).
  for (const fid of facilityIds) {
    const fac = town.facilities[fid]!;
    const firm = town.firms[fac.ownerFirmId];
    const eligible =
      fac.status !== 'closed' &&
      firm !== undefined &&
      (firm.ownerType === 'player' || firm.ownerType === 'ai') &&
      fac.workerCapacity > 0;
    if (!eligible) {
      fac.crowdByCohort = {};
      continue;
    }
    let over = fac.employees.length + crowdCount(fac) - fac.workerCapacity;
    while (over > 0) {
      let worst: string | null = null;
      for (const cid of Object.keys(fac.crowdByCohort).sort()) {
        if (worst === null || fac.crowdByCohort[cid]! > fac.crowdByCohort[worst]!) worst = cid;
      }
      if (worst === null) break;
      const take = Math.min(over, fac.crowdByCohort[worst]!);
      fac.crowdByCohort[worst]! -= take;
      if (fac.crowdByCohort[worst]! <= 0) delete fac.crowdByCohort[worst];
      over -= take;
    }
    for (const cid of Object.keys(fac.crowdByCohort)) {
      employedByCohort[cid] = (employedByCohort[cid] ?? 0) + fac.crowdByCohort[cid]!;
    }
  }

  // Pass 2 — population shrank below assignments (migration, later arcs):
  // release the excess, smallest facility holdings first for stability.
  for (const cid of cohortIds) {
    const cohort = cohorts[cid]!;
    let excess = (employedByCohort[cid] ?? 0) - cohort.population;
    if (excess <= 0) continue;
    for (const fid of facilityIds) {
      if (excess <= 0) break;
      const fac = town.facilities[fid]!;
      const n = fac.crowdByCohort[cid] ?? 0;
      if (n <= 0) continue;
      const take = Math.min(n, excess);
      fac.crowdByCohort[cid] = n - take;
      if (fac.crowdByCohort[cid]! <= 0) delete fac.crowdByCohort[cid];
      employedByCohort[cid]! -= take;
      excess -= take;
    }
  }

  // Pass 3 — fill open slots from cohorts with idle hands, while the owner
  // can afford the projected payroll with a buffer.
  for (const fid of facilityIds) {
    const fac = town.facilities[fid]!;
    const firm = town.firms[fac.ownerFirmId];
    if (!firm || (firm.ownerType !== 'player' && firm.ownerType !== 'ai')) continue;
    if (fac.status === 'closed' || fac.workerCapacity <= 0) continue;
    let room = fac.workerCapacity - fac.employees.length - crowdCount(fac);
    if (room <= 0) continue;

    const wage = firm.wagePolicy.baseWage;
    // Projected daily bill: cast + crowd across the whole firm.
    let firmCrowd = 0;
    for (const ofid of firm.facilities) {
      const of = town.facilities[ofid];
      if (of) firmCrowd += crowdCount(of);
    }
    const dailyBill = () => (firm.employees.length + firmCrowd) * wage;

    for (const cid of cohortIds) {
      if (room <= 0) break;
      const cohort = cohorts[cid]!;
      const idle = cohort.population - (employedByCohort[cid] ?? 0);
      if (idle <= 0) continue;
      let take = Math.min(room, idle);
      // Affordability: shrink the intake until the buffered bill fits.
      while (take > 0 && (dailyBill() + take * wage) * CROWD_WAGE_BUFFER_DAYS > firm.cash) {
        take -= 1;
      }
      if (take <= 0) continue;
      fac.crowdByCohort[cid] = (fac.crowdByCohort[cid] ?? 0) + take;
      employedByCohort[cid] = (employedByCohort[cid] ?? 0) + take;
      firmCrowd += take;
      room -= take;
    }
  }

  for (const cid of cohortIds) {
    cohorts[cid]!.employed = employedByCohort[cid] ?? 0;
  }
}
