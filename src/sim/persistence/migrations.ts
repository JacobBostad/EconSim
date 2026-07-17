/**
 * migrations.ts — forward-migrate older saves to the current SAVE_VERSION.
 *
 * Two layers:
 *  1. Versioned migrations (registry below) for breaking shape changes.
 *  2. `normalize` — a defensive pass that fills in any missing fields with
 *     defaults. Because the live site autosaves continuously, players can hold
 *     saves from any deploy; normalization keeps every old save loadable as
 *     the entity model grows (brand/quality/debt/shares, new P&L lines, ...).
 */

import { SAVE_VERSION } from '../core/GameState';
import type { GameState } from '../core/GameState';
import type { AccountingPeriod } from '../entities/Accounting';

type Raw = Record<string, unknown>;

const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // Example for the future:
  // 1: (raw) => ({ ...raw, saveVersion: 2, newField: defaultValue }),
};

export function migrate(raw: Raw): GameState {
  let current = raw;
  let version = typeof raw.saveVersion === 'number' ? raw.saveVersion : 0;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No migration registered; assume forward-compatible and bump.
      current = { ...current, saveVersion: version + 1 };
    } else {
      current = step(current);
    }
    version += 1;
  }
  return normalize(current as unknown as GameState);
}

function normPeriod(p: Partial<AccountingPeriod> | undefined): AccountingPeriod {
  return {
    revenue: p?.revenue ?? 0,
    costOfGoodsSold: p?.costOfGoodsSold ?? 0,
    wages: p?.wages ?? 0,
    maintenance: p?.maintenance ?? 0,
    logisticsCost: p?.logisticsCost ?? 0,
    variableProductionCost: p?.variableProductionCost ?? 0,
    marketing: p?.marketing ?? 0,
    rnd: p?.rnd ?? 0,
    interest: p?.interest ?? 0,
    buildSpend: p?.buildSpend ?? 0,
  };
}

/** Fill any missing fields introduced after the save was written. */
function normalize(state: GameState): GameState {
  state.worldEvents = state.worldEvents ?? [];
  for (const id in state.firms) {
    const f = state.firms[id]!;
    f.brandByProduct = f.brandByProduct ?? {};
    f.adBudgetByProduct = f.adBudgetByProduct ?? {};
    f.qualityByProduct = f.qualityByProduct ?? {};
    f.debt = f.debt ?? 0;
    f.interestRatePerDay = f.interestRatePerDay ?? 0.0009;
    f.sharesHeld = f.sharesHeld ?? {};
    f.accounting.lifetime = normPeriod(f.accounting.lifetime);
    f.accounting.today = normPeriod(f.accounting.today);
    f.accounting.dailyHistory = (f.accounting.dailyHistory ?? []).map((d) => ({
      ...d,
      marketing: d.marketing ?? 0,
      rnd: d.rnd ?? 0,
      interest: d.interest ?? 0,
      netProfit: d.netProfit ?? d.operatingProfit ?? 0,
      debt: d.debt ?? 0,
      valuation: d.valuation ?? (d.cash ?? 0) + (d.inventoryValue ?? 0) - (d.debt ?? 0),
    }));
    f.accounting.weeklyHistory = (f.accounting.weeklyHistory ?? []).map((d) => ({
      ...d,
      marketing: d.marketing ?? 0,
      rnd: d.rnd ?? 0,
      interest: d.interest ?? 0,
      netProfit: d.netProfit ?? d.operatingProfit ?? 0,
      debt: d.debt ?? 0,
      valuation: d.valuation ?? (d.cash ?? 0) + (d.inventoryValue ?? 0) - (d.debt ?? 0),
    }));
  }
  for (const pid in state.marketStats) {
    const stat = state.marketStats[pid]!;
    stat.history = stat.history ?? [];
  }
  for (const id in state.citizens) {
    const c = state.citizens[id]!;
    c.lastShopTick = c.lastShopTick ?? -1000;
    c.missedPaydays = c.missedPaydays ?? 0;
    c.storeReliability = c.storeReliability ?? {};
  }
  return state;
}
