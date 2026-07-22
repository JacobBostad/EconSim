/**
 * PayrollSystem — pays wages on paydays.
 *
 * On a payday (day boundary on the configured interval) every firm pays each
 * employee their wage. If a firm cannot cover a wage, the payment is missed:
 * the worker's satisfaction drops and their missed-payday counter rises; after
 * enough consecutive misses the worker quits and becomes unemployed.
 */

import type { SimContext, GameState } from '../core/GameState';
import { recordTransaction, emitEvent, canAfford } from '../core/GameState';
import { townOf } from '../core/Town';
import { firmAccount, citizenAccount, cohortAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { clamp } from '../../utils/clamp';

const QUIT_AFTER_MISSED = 3;

export function runPayrollSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  if (ctx.time.day % ctx.config.payrollIntervalDays !== 0) return;
  const { state } = ctx;
  const town = townOf(state, ctx.townId);

  // Subsistence income for the unemployed (keeps consumer demand alive).
  const stipend = ctx.config.subsistenceIncomePerDay * ctx.config.payrollIntervalDays;
  if (stipend > 0) {
    for (const cid in town.citizens) {
      const cit = town.citizens[cid]!;
      if (cit.employmentStatus !== 'unemployed') continue;
      recordTransaction(state, {
        from: WORLD_ACCOUNT,
        to: citizenAccount(cit.id),
        amount: stipend,
        firmId: null,
        category: 'none',
        note: 'Subsistence income',
      });
    }
  }

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType === 'world' || firm.ownerType === 'external') continue;
    if (firm.employees.length === 0) continue;

    const quitters: string[] = [];
    for (const cid of firm.employees) {
      const cit = town.citizens[cid];
      if (!cit) continue;
      const wage = cit.wage;
      if (wage > 0 && canAfford(state, firmAccount(firm.id), wage)) {
        recordTransaction(state, {
          from: firmAccount(firm.id),
          to: citizenAccount(cit.id),
          amount: wage,
          firmId: firm.id,
          category: 'wages',
          note: `Wage to ${cit.name}`,
        });
        cit.dailyStats.wagesEarned += wage;
        cit.missedPaydays = 0;
      } else {
        cit.missedPaydays += 1;
        cit.satisfaction = clamp(cit.satisfaction - 5, 0, 100);
        emitEvent(
          state,
          'warning',
          'payroll',
          `${firm.name} missed payroll for ${cit.name}.`,
          firm.id,
        );
        if (cit.missedPaydays >= QUIT_AFTER_MISSED) quitters.push(cid);
      }
    }

    for (const cid of quitters) quit(ctx, firm.id, cid);
  }

  payCrowd(ctx);
}

/**
 * Crowd payroll (Arc A3): one transaction per firm × cohort covering every
 * crowd worker across that firm's facilities, plus the same subsistence
 * stipend the unemployed cast gets for each idle crowd member — keeping the
 * cohort pools' purchasing power alive exactly like the cast's. A firm that
 * can't cover a cohort's bill loses that cohort's workers on the spot (the
 * anonymous crowd doesn't wait three paydays the way a named citizen does).
 * No-op in towns without cohorts.
 */
function payCrowd(ctx: SimContext): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const cohortIds = Object.keys(town.cohorts).sort();
  if (cohortIds.length === 0) return;
  const days = ctx.config.payrollIntervalDays;

  // Idle-crowd stipend, one transaction per cohort.
  const stipend = ctx.config.subsistenceIncomePerDay * days;
  for (const cid of cohortIds) {
    const cohort = town.cohorts[cid]!;
    const idle = cohort.population - cohort.employed;
    if (idle <= 0 || stipend <= 0) continue;
    recordTransaction(state, {
      from: WORLD_ACCOUNT,
      to: cohortAccount(cid),
      amount: idle * stipend,
      firmId: null,
      category: 'none',
      note: `Crowd subsistence (${idle})`,
    });
  }

  // Wages, one transaction per firm × cohort.
  for (const fid of Object.keys(state.firms).sort()) {
    const firm = state.firms[fid]!;
    if (firm.ownerType === 'world' || firm.ownerType === 'external') continue;
    const byCohort: Record<string, number> = {};
    for (const facId of [...firm.facilities].sort()) {
      const fac = state.facilities[facId];
      if (!fac) continue;
      for (const cid of Object.keys(fac.crowdByCohort)) {
        byCohort[cid] = (byCohort[cid] ?? 0) + fac.crowdByCohort[cid]!;
      }
    }
    for (const cid of Object.keys(byCohort).sort()) {
      const workers = byCohort[cid]!;
      const bill = workers * firm.wagePolicy.baseWage * days;
      if (bill <= 0) continue;
      if (canAfford(state, firmAccount(firm.id), bill)) {
        recordTransaction(state, {
          from: firmAccount(firm.id),
          to: cohortAccount(cid),
          amount: bill,
          firmId: firm.id,
          category: 'wages',
          note: `Crowd wages (${workers})`,
        });
      } else {
        releaseCrowd(state, firm.id, cid);
        emitEvent(state, 'warning', 'payroll',
          `${firm.name} couldn't pay its ${workers} crowd workers — they walked off the job.`, firm.id);
      }
    }
  }
}

/** Remove every worker of one cohort from one firm's facilities. */
function releaseCrowd(state: GameState, firmId: string, cohortId: string): void {
  const firm = state.firms[firmId];
  // Bare-`state` helper mid-gradient: home town by default (one-town region →
  // same reference); gains a `townId` param at the endgame move.
  const cohort = townOf(state).cohorts[cohortId];
  if (!firm || !cohort) return;
  for (const facId of [...firm.facilities].sort()) {
    const fac = state.facilities[facId];
    if (!fac) continue;
    const n = fac.crowdByCohort[cohortId] ?? 0;
    if (n <= 0) continue;
    delete fac.crowdByCohort[cohortId];
    cohort.employed = Math.max(0, cohort.employed - n);
  }
}

function quit(ctx: SimContext, firmId: string, citizenId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const cit = townOf(state, ctx.townId).citizens[citizenId];
  if (!cit) return;
  firm.employees = firm.employees.filter((id) => id !== citizenId);
  if (cit.workplaceFacilityId) {
    const fac = state.facilities[cit.workplaceFacilityId];
    if (fac) fac.employees = fac.employees.filter((id) => id !== citizenId);
  }
  cit.employerFirmId = null;
  cit.workplaceFacilityId = null;
  cit.employmentStatus = 'unemployed';
  cit.role = 'unemployed';
  cit.wage = 0;
  cit.missedPaydays = 0;
  emitEvent(
    state,
    'danger',
    'payroll',
    `${cit.name} quit ${firm.name} after unpaid wages.`,
    firmId,
  );
}
