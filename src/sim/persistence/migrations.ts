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
import { emptyFacilityDailyStats } from '../entities/Facility';
import { getProduct } from '../data/products';
import { getFacilityDef } from '../data/facilityDefinitions';
import { defaultPersonalityFor, defaultCeoFor, type PersonalityId } from '../data/personalities';
import { TRADE_CITY_IDS, cityBias } from '../data/tradeCities';

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
  state.config.challengeMode = state.config.challengeMode ?? false;
  state.scenarioId = state.scenarioId ?? 'meadowbrook';
  state.townHistory = state.townHistory ?? [];
  state.rushOrder = state.rushOrder ?? null;
  state.rushOrdersCompleted = state.rushOrdersCompleted ?? 0;
  state.rushOrdersMissed = state.rushOrdersMissed ?? 0;
  state.facilityOffer = state.facilityOffer ?? null;
  state.fireSalesBought = state.fireSalesBought ?? 0;
  state.config.maxHomes = state.config.maxHomes ?? 40;
  state.config.maxCitizens = state.config.maxCitizens ?? 80;
  state.config.playerStartCash = state.config.playerStartCash ?? 15000 * 100;
  state.config.worldEventDailyChance = state.config.worldEventDailyChance ?? 0.2;
  state.config.aiExpandChance = state.config.aiExpandChance ?? 0.5;
  let aiSeen = 0;
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
    f.exportRevenueByCity = f.exportRevenueByCity ?? {};
    f.wholesaleSpend = f.wholesaleSpend ?? 0;
    f.wholesaleEarned = f.wholesaleEarned ?? 0;
    if (f.personalityId === undefined || f.ceoName === undefined) {
      // Old saves: give existing AI firms a deterministic personality + CEO.
      if (f.ownerType === 'ai') {
        const p = f.personalityId ?? defaultPersonalityFor(aiSeen);
        f.personalityId = p;
        f.ceoName = f.ceoName ?? defaultCeoFor(p as PersonalityId, aiSeen);
      } else {
        f.personalityId = f.personalityId ?? null;
        f.ceoName = f.ceoName ?? null;
      }
    }
    if (f.ownerType === 'ai') aiSeen += 1;
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
    f.exportOrders = f.exportOrders ?? {};
    f.builtAtTick = f.builtAtTick ?? 0;
    f.dailyStats.bottleneck = f.dailyStats.bottleneck ?? null;
    f.dailyStats.pricedOut = f.dailyStats.pricedOut ?? 0;
    f.dailyStats.transferOutValue = f.dailyStats.transferOutValue ?? 0;
    f.dailyStats.transferInValue = f.dailyStats.transferInValue ?? 0;
    f.yesterdayStats = f.yesterdayStats ?? emptyFacilityDailyStats();
    f.yesterdayStats.transferOutValue = f.yesterdayStats.transferOutValue ?? 0;
    f.yesterdayStats.transferInValue = f.yesterdayStats.transferInValue ?? 0;
    f.pnlEma = f.pnlEma ?? { revenue: 0, cost: 0, net: 0 };
    f.wholesaleEnabled = f.wholesaleEnabled ?? true;
    // Multi-product retail: wrap the legacy single retailProductId.
    if (!Array.isArray(f.retailProductIds)) {
      const legacy = (f as unknown as { retailProductId?: string | null }).retailProductId;
      f.retailProductIds = legacy ? [legacy] : [];
      delete (f as unknown as { retailProductId?: string | null }).retailProductId;
    }
  }
  // ...and give the market a stat entry for them.
  for (const pid of ALL_PRODUCT_IDS) {
    state.marketStats[pid] = state.marketStats[pid] ?? emptyMarketStat(pid);
  }
  // Trade cities: single-city saves carried `tradeCity` (Port Rosa); move it
  // into the keyed map and seed any city (or product) the save predates.
  const legacyCity = (state as unknown as { tradeCity?: { pricesByProduct: Record<string, number> } }).tradeCity;
  state.tradeCities = state.tradeCities ?? {};
  if (legacyCity && !state.tradeCities['port_rosa']) {
    state.tradeCities['port_rosa'] = legacyCity;
  }
  delete (state as unknown as { tradeCity?: unknown }).tradeCity;
  for (const cid of TRADE_CITY_IDS) {
    state.tradeCities[cid] = state.tradeCities[cid] ?? { pricesByProduct: {} };
    for (const pid of ALL_PRODUCT_IDS) {
      state.tradeCities[cid]!.pricesByProduct[pid] =
        state.tradeCities[cid]!.pricesByProduct[pid] ??
        Math.round(getProduct(pid).basePrice * cityBias(cid, pid));
    }
  }
  return state;
}
