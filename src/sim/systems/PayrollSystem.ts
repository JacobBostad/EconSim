/**
 * PayrollSystem — pays wages on paydays.
 *
 * On a payday (day boundary on the configured interval) every firm pays each
 * employee their wage. If a firm cannot cover a wage, the payment is missed:
 * the worker's satisfaction drops and their missed-payday counter rises; after
 * enough consecutive misses the worker quits and becomes unemployed.
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction, emitEvent, canAfford } from '../core/GameState';
import { firmAccount, citizenAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { clamp } from '../../utils/clamp';

const QUIT_AFTER_MISSED = 3;

export function runPayrollSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  if (ctx.time.day % ctx.config.payrollIntervalDays !== 0) return;
  const { state } = ctx;

  // Subsistence income for the unemployed (keeps consumer demand alive).
  const stipend = ctx.config.subsistenceIncomePerDay * ctx.config.payrollIntervalDays;
  if (stipend > 0) {
    for (const cid in state.citizens) {
      const cit = state.citizens[cid]!;
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
      const cit = state.citizens[cid];
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
}

function quit(ctx: SimContext, firmId: string, citizenId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const cit = state.citizens[citizenId];
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
