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
import { townOf } from '../core/Town';
import { isDayBoundary } from '../core/Tick';
import { crowdCount } from '../entities/Facility';
import { isWorkTime } from './CitizenScheduleSystem';

/** A firm hires crowd only while its cash covers this many days of the
 * projected wage bill — the same instinct the AI applies to cast hiring. */
const CROWD_WAGE_BUFFER_DAYS = 7;

function anyCrowd(state: GameState): boolean {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohorts = townOf(state).cohorts;
  for (const cid in cohorts) {
    if (cohorts[cid]!.population > 0) return true;
  }
  return false;
}

export function runCohortLaborSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!anyCrowd(state)) return;
  const town = townOf(state, ctx.townId);

  if (isDayBoundary(state.tick, ctx.config)) reconcileCrowdJobs(state);

  // Crowd presence: cohort workers keep facility hours, not commutes.
  if (isWorkTime(ctx)) {
    for (const fid in state.facilities) {
      const fac = state.facilities[fid]!;
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

function reconcileCrowdJobs(state: GameState): void {
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohorts = townOf(state).cohorts;
  const cohortIds = Object.keys(cohorts).sort();
  const facilityIds = Object.keys(state.facilities).sort();

  // Rebuild employment counts from assignments so they can never drift.
  const employedByCohort: Record<string, number> = {};
  for (const cid of cohortIds) employedByCohort[cid] = 0;

  // Pass 1 — evictions: closed/ineligible facilities lose their crowd, and
  // where the cast has grown into the capacity, crowd yields (largest
  // holdings first, id tiebreak).
  for (const fid of facilityIds) {
    const fac = state.facilities[fid]!;
    const firm = state.firms[fac.ownerFirmId];
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
      const fac = state.facilities[fid]!;
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
    const fac = state.facilities[fid]!;
    const firm = state.firms[fac.ownerFirmId];
    if (!firm || (firm.ownerType !== 'player' && firm.ownerType !== 'ai')) continue;
    if (fac.status === 'closed' || fac.workerCapacity <= 0) continue;
    let room = fac.workerCapacity - fac.employees.length - crowdCount(fac);
    if (room <= 0) continue;

    const wage = firm.wagePolicy.baseWage;
    // Projected daily bill: cast + crowd across the whole firm.
    let firmCrowd = 0;
    for (const ofid of firm.facilities) {
      const of = state.facilities[ofid];
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
