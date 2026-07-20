/**
 * Accounting.ts — Firm financial records.
 *
 * Lifetime accumulators are updated atomically whenever a transaction is
 * recorded (see core/Transactions.ts), so they always match the transaction
 * history. Daily/weekly snapshots are rolled up by AccountingSystem.
 */

export interface AccountingPeriod {
  revenue: number;
  costOfGoodsSold: number;
  wages: number;
  maintenance: number;
  logisticsCost: number;
  variableProductionCost: number;
  marketing: number;
  rnd: number;
  interest: number;
  buildSpend: number;
  /** Dividends received from held stakes — investment income, part of net
   * profit (the earnings multiple capitalizes it like any other income). */
  dividendIn: number;
  /** Dividends paid to shareholders — a distribution of profit, NOT an
   * expense: it never reduces net profit (else payouts would shrink the
   * very profit they are computed from). */
  dividendOut: number;
  /** Cash spent buying stakes / received selling them — balance-sheet
   * moves (the stake itself is valued in companyValuation), P&L-neutral. */
  shareBuy: number;
  shareSell: number;
}

export function emptyPeriod(): AccountingPeriod {
  return {
    revenue: 0,
    costOfGoodsSold: 0,
    wages: 0,
    maintenance: 0,
    logisticsCost: 0,
    variableProductionCost: 0,
    marketing: 0,
    rnd: 0,
    interest: 0,
    buildSpend: 0,
    dividendIn: 0,
    dividendOut: 0,
    shareBuy: 0,
    shareSell: 0,
  };
}

export interface DailySnapshot {
  day: number;
  revenue: number;
  costOfGoodsSold: number;
  wages: number;
  maintenance: number;
  logisticsCost: number;
  variableProductionCost: number;
  marketing: number;
  rnd: number;
  interest: number;
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
  cash: number;
  debt: number;
  inventoryValue: number;
  /** End-of-day company valuation (for the trend chart). */
  valuation: number;
  /** Capital spent on construction that day (growth-phase signal). */
  buildSpend: number;
}

export interface Accounting {
  /** Lifetime totals — always equal to the sum over this firm's transactions. */
  lifetime: AccountingPeriod;
  /** Running totals for the current day, reset at day rollover. */
  today: AccountingPeriod;
  /** Per-day history (bounded). */
  dailyHistory: DailySnapshot[];
  /** Per-week aggregated history (bounded). */
  weeklyHistory: DailySnapshot[];
}

export function emptyAccounting(): Accounting {
  return {
    lifetime: emptyPeriod(),
    today: emptyPeriod(),
    dailyHistory: [],
    weeklyHistory: [],
  };
}

export function grossProfit(p: AccountingPeriod): number {
  return p.revenue - p.costOfGoodsSold;
}

export function operatingProfit(p: AccountingPeriod): number {
  return (
    p.revenue -
    p.costOfGoodsSold -
    p.wages -
    p.maintenance -
    p.logisticsCost -
    p.variableProductionCost -
    p.marketing -
    p.rnd
  );
}

/** Net profit = operating profit minus interest, plus investment income
 * (dividends from held stakes). Dividends PAID are a distribution, not an
 * expense, so they do not appear here. */
export function netProfit(p: AccountingPeriod): number {
  return operatingProfit(p) - p.interest + (p.dividendIn ?? 0);
}
