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
import { CONSUMER_PRODUCT_IDS, ALL_PRODUCT_IDS } from '../data/products';
import { emptyMarketStat } from '../entities/Market';
import { defaultNeedFor } from '../entities/factories';
import { getProduct } from '../data/products';
import { getFacilityDef } from '../data/facilityDefinitions';

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
  state.achievements = state.achievements ?? [];
  state.missions = state.missions ?? [];
  // Difficulty knobs (older saves predate presets -> standard values).
  state.config.difficulty = state.config.difficulty ?? 'standard';
  state.config.playerStartCash = state.config.playerStartCash ?? 15000 * 100;
  state.config.worldEventDailyChance = state.config.worldEventDailyChance ?? 0.2;
  state.config.aiExpandChance = state.config.aiExpandChance ?? 0.5;
  for (const id in state.firms) {
    const f = state.firms[id]!;
    f.brandByProduct = f.brandByProduct ?? {};
    f.adBudgetByProduct = f.adBudgetByProduct ?? {};
    f.qualityByProduct = f.qualityByProduct ?? {};
    f.debt = f.debt ?? 0;
    f.interestRatePerDay = f.interestRatePerDay ?? 0.0009;
    f.sharesHeld = f.sharesHeld ?? {};
    f.acquiredNames = f.acquiredNames ?? [];
    f.autoPriceByProduct = f.autoPriceByProduct ?? {};
    f.exportRevenue = f.exportRevenue ?? 0;
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
      buildSpend: d.buildSpend ?? 0,
    }));
    f.accounting.weeklyHistory = (f.accounting.weeklyHistory ?? []).map((d) => ({
      ...d,
      marketing: d.marketing ?? 0,
      rnd: d.rnd ?? 0,
      interest: d.interest ?? 0,
      netProfit: d.netProfit ?? d.operatingProfit ?? 0,
      debt: d.debt ?? 0,
      valuation: d.valuation ?? (d.cash ?? 0) + (d.inventoryValue ?? 0) - (d.debt ?? 0),
      buildSpend: d.buildSpend ?? 0,
    }));
  }
  for (const pid in state.marketStats) {
    const stat = state.marketStats[pid]!;
    stat.history = (stat.history ?? []).map((h) => ({
      ...h,
      tradePrice: h.tradePrice ?? getProduct(pid).basePrice,
    }));
  }
  for (const id in state.citizens) {
    const c = state.citizens[id]!;
    c.lastShopTick = c.lastShopTick ?? -1000;
    c.missedPaydays = c.missedPaydays ?? 0;
    c.storeReliability = c.storeReliability ?? {};
    c.skill = c.skill ?? 1.0;
    // Products added after the save was written: give citizens the need.
    for (const pid of CONSUMER_PRODUCT_IDS) {
      if (!c.needs.some((n) => n.productId === pid)) {
        const need = defaultNeedFor(pid);
        if (need) c.needs.push(need);
      }
      c.preferences[pid] = c.preferences[pid] ?? 1;
    }
  }
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    f.presentSkill = f.presentSkill ?? 0;
    f.level = f.level ?? 1;
    f.workerCapacity = f.workerCapacity ?? getFacilityDef(f.defId).workerCapacity;
  }
  // ...and give the market a stat entry for them.
  state.tradeCity = state.tradeCity ?? { pricesByProduct: {} };
  for (const pid of ALL_PRODUCT_IDS) {
    state.marketStats[pid] = state.marketStats[pid] ?? emptyMarketStat(pid);
    state.tradeCity.pricesByProduct[pid] =
      state.tradeCity.pricesByProduct[pid] ?? getProduct(pid).basePrice;
  }
  return state;
}
