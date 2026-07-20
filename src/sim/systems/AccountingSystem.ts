/**
 * AccountingSystem — charges daily maintenance and rolls up the books.
 *
 * Runs at each day boundary. It (1) charges each firm's facility maintenance to
 * the world account, (2) snapshots the completed day's P&L from the firm's
 * `today` accumulators, (3) computes current inventory value, (4) resets daily
 * accumulators (firm/facility/citizen), and (5) aggregates weekly history.
 *
 * Because every accumulator is fed by recordTransaction, the snapshots always
 * reconcile with the transaction log (see tests/accounting.test.ts).
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import {
  emptyPeriod,
  grossProfit,
  operatingProfit,
  netProfit,
  type DailySnapshot,
} from '../entities/Accounting';
import { emptyFacilityDailyStats, crowdCount } from '../entities/Facility';
import { getProduct } from '../data/products';
import { companyValuation } from '../selectors/companySelectors';

export function runAccountingSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const completedDay = ctx.time.day - 1;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType === 'player' || firm.ownerType === 'ai') {
      // 1) Maintenance.
      for (const facId of firm.facilities) {
        const fac = state.facilities[facId];
        if (!fac || fac.status === 'closed') continue;
        if (fac.operatingCostPerDay > 0) {
          recordTransaction(state, {
            from: firmAccount(firm.id),
            to: WORLD_ACCOUNT,
            amount: fac.operatingCostPerDay,
            firmId: firm.id,
            category: 'maintenance',
            note: `Maintenance: ${fac.name}`,
          });
        }
      }
    }

    // 2) Snapshot the completed day.
    const today = firm.accounting.today;
    const snapshot: DailySnapshot = {
      day: completedDay,
      revenue: today.revenue,
      costOfGoodsSold: today.costOfGoodsSold,
      wages: today.wages,
      maintenance: today.maintenance,
      logisticsCost: today.logisticsCost,
      variableProductionCost: today.variableProductionCost,
      serviceExpense: today.serviceExpense ?? 0,
      marketing: today.marketing,
      rnd: today.rnd,
      interest: today.interest,
      grossProfit: grossProfit(today),
      operatingProfit: operatingProfit(today),
      netProfit: netProfit(today),
      cash: firm.cash,
      debt: firm.debt,
      inventoryValue: computeInventoryValue(ctx, firm.facilities),
      valuation: companyValuation(state, firm.id).valuation,
      buildSpend: today.buildSpend,
    };
    firm.accounting.dailyHistory.push(snapshot);
    trim(firm.accounting.dailyHistory, state.config.maxDailyHistory);

    // 4) Reset today's accumulators.
    firm.accounting.today = emptyPeriod();

    // 5) Weekly aggregation at end of each 7-day block.
    if (completedDay >= 0 && (completedDay + 1) % 7 === 0) {
      aggregateWeek(firm);
    }
  }

  // Snapshot then reset per-day facility stats (yesterdayStats is what the
  // UI and advisors read — dailyStats is partial for most of the day), and
  // fold the closed day into the 7-day P&L EMA: ship-day/idle-day rhythms
  // make single days flip-flop, so ranking/advice keys off this instead.
  const EMA_ALPHA = 1 / 7;
  for (const facId in state.facilities) {
    const fac = state.facilities[facId]!;
    fac.yesterdayStats = fac.dailyStats;
    fac.dailyStats = emptyFacilityDailyStats();

    const owner = state.firms[fac.ownerFirmId];
    const y = fac.yesterdayStats;
    const revenue = y.revenue + y.transferOutValue;
    const wages = owner
      ? (fac.employees.length + crowdCount(fac)) * owner.wagePolicy.baseWage
      : 0;
    const cost = wages + fac.operatingCostPerDay + y.variableCost + y.transferInValue;
    fac.pnlEma.revenue += (revenue - fac.pnlEma.revenue) * EMA_ALPHA;
    fac.pnlEma.cost += (cost - fac.pnlEma.cost) * EMA_ALPHA;
    fac.pnlEma.net = fac.pnlEma.revenue - fac.pnlEma.cost;
  }
  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    cit.dailyStats = {
      day: ctx.time.day,
      wagesEarned: 0,
      spent: 0,
      purchases: 0,
      unmetNeeds: 0,
    };
  }
}

function computeInventoryValue(ctx: SimContext, facilityIds: string[]): number {
  let value = 0;
  for (const fid of facilityIds) {
    const fac = ctx.state.facilities[fid];
    if (!fac) continue;
    for (const inv of [fac.inputInventory, fac.outputInventory]) {
      for (const pid in inv) {
        value += inv[pid]!.quantity * getProduct(pid).basePrice;
      }
    }
  }
  return value;
}

function aggregateWeek(firm: import('../entities/Firm').Firm): void {
  const recent = firm.accounting.dailyHistory.slice(-7);
  if (recent.length === 0) return;
  const acc: DailySnapshot = {
    day: recent[recent.length - 1]!.day,
    revenue: 0,
    costOfGoodsSold: 0,
    wages: 0,
    maintenance: 0,
    logisticsCost: 0,
    variableProductionCost: 0,
    serviceExpense: 0,
    marketing: 0,
    rnd: 0,
    interest: 0,
    grossProfit: 0,
    operatingProfit: 0,
    netProfit: 0,
    cash: firm.cash,
    debt: firm.debt,
    inventoryValue: recent[recent.length - 1]!.inventoryValue,
    valuation: recent[recent.length - 1]!.valuation,
    buildSpend: 0,
  };
  for (const d of recent) {
    acc.revenue += d.revenue;
    acc.costOfGoodsSold += d.costOfGoodsSold;
    acc.wages += d.wages;
    acc.maintenance += d.maintenance;
    acc.logisticsCost += d.logisticsCost;
    acc.variableProductionCost += d.variableProductionCost;
    acc.serviceExpense = (acc.serviceExpense ?? 0) + (d.serviceExpense ?? 0);
    acc.marketing += d.marketing;
    acc.rnd += d.rnd;
    acc.interest += d.interest;
    acc.grossProfit += d.grossProfit;
    acc.operatingProfit += d.operatingProfit;
    acc.netProfit += d.netProfit;
    acc.buildSpend += d.buildSpend;
  }
  firm.accounting.weeklyHistory.push(acc);
  trim(firm.accounting.weeklyHistory, 60);
}

function trim<T>(arr: T[], max: number): void {
  if (arr.length > max) arr.splice(0, arr.length - max);
}
