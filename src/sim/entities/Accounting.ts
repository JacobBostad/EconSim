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
  buildSpend: number;
}

export function emptyPeriod(): AccountingPeriod {
  return {
    revenue: 0,
    costOfGoodsSold: 0,
    wages: 0,
    maintenance: 0,
    logisticsCost: 0,
    variableProductionCost: 0,
    buildSpend: 0,
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
  grossProfit: number;
  operatingProfit: number;
  cash: number;
  inventoryValue: number;
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
    p.variableProductionCost
  );
}
