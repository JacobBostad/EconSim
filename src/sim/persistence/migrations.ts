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
import { PRODUCT_IDS_BY_PRESET, CONSUMER_PRODUCT_IDS_BY_PRESET } from '../data/products';
import { emptyMarketStat } from '../entities/Market';
import { defaultNeedFor } from '../entities/factories';
import { emptyFacilityDailyStats } from '../entities/Facility';
import { snapshotTier } from '../systems/TierSystem';
import { getProduct } from '../data/products';
import { getFacilityDef } from '../data/facilityDefinitions';
import { defaultPersonalityFor, defaultCeoFor, type PersonalityId } from '../data/personalities';
import { TRADE_CITY_IDS, cityBias } from '../data/tradeCities';
import { marketCap } from '../selectors/companySelectors';
import { defaultDistrictPartition } from '../data/districts';
import { seedNeedBuckets } from '../entities/Cohort';

type Raw = Record<string, unknown>;

export const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // v1 -> v2 (Arc D1, the firm-archetype framework): every firm's strategy gains
  // an `archetype`. Old saves predate specialist firms, so every firm was an
  // operator — stamp `strategy.archetype = 'operator'` on each. Money, rng,
  // facilities, contracts are untouched: the loaded world is byte-for-byte the
  // same run it was, now carrying one new classifier field per firm.
  1: (raw) => {
    const firms = raw.firms as Record<string, { strategy?: { archetype?: string } }> | undefined;
    if (firms) {
      for (const id in firms) {
        const strat = firms[id]?.strategy;
        if (strat && strat.archetype === undefined) strat.archetype = 'operator';
      }
    }
    return { ...raw, saveVersion: 2 };
  },
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
    serviceExpense: p?.serviceExpense ?? 0,
    rentExpense: p?.rentExpense ?? 0,
    marketing: p?.marketing ?? 0,
    rnd: p?.rnd ?? 0,
    interest: p?.interest ?? 0,
    buildSpend: p?.buildSpend ?? 0,
    dividendIn: p?.dividendIn ?? 0,
    dividendOut: p?.dividendOut ?? 0,
    shareBuy: p?.shareBuy ?? 0,
    shareSell: p?.shareSell ?? 0,
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
  for (const d of state.townHistory) {
    // Pre-tier saves: treat history as all-worker (honest default).
    d.workers = d.workers ?? d.population;
    d.comfortable = d.comfortable ?? 0;
    d.affluent = d.affluent ?? 0;
  }
  state.rushOrder = state.rushOrder ?? null;
  state.tradeAnnouncement = state.tradeAnnouncement ?? null;
  state.rushOrdersCompleted = state.rushOrdersCompleted ?? 0;
  state.rushOrdersMissed = state.rushOrdersMissed ?? 0;
  state.facilityOffer = state.facilityOffer ?? null;
  state.fireSalesBought = state.fireSalesBought ?? 0;
  state.deskTrades = state.deskTrades ?? 0;
  state.emigrationPressure = state.emigrationPressure ?? 0;
  state.emigrationDepartures = state.emigrationDepartures ?? 0;
  state.marketGapDays = state.marketGapDays ?? {};
  state.marketUndersupplyDays = state.marketUndersupplyDays ?? {};
  state.lastUndersupplyEntryDay = state.lastUndersupplyEntryDay ?? 0;
  state.investorSignalDays = state.investorSignalDays ?? 0;
  state.lastInvestorEntryDay = state.lastInvestorEntryDay ?? 0;
  // Service-provider founder signal (Arc D4): saves predating it load with empty
  // counters and no last-entry day — inert until a City game turns services on.
  state.serviceUncoveredDays = state.serviceUncoveredDays ?? {};
  state.lastServiceEntryDay = state.lastServiceEntryDay ?? 0;
  state.sharePriceShift = state.sharePriceShift ?? {};
  state.config.sizePreset = state.config.sizePreset ?? 'village';
  // B2B services channel (HD3): saves predating it load with the channel off and
  // no contracts — inert until a new City game turns it on.
  state.config.servicesEnabled = state.config.servicesEnabled ?? false;
  state.config.investorsEnabled = state.config.investorsEnabled ?? false;
  state.serviceContracts = state.serviceContracts ?? {};
  // Real-estate firms channel (Arc D2, HD4): saves predating it load with the
  // channel off — no landlord ever founds until a City game turns it on.
  state.config.realEstateEnabled = state.config.realEstateEnabled ?? false;
  state.housingTightDays = state.housingTightDays ?? 0;
  state.lastLandlordEntryDay = state.lastLandlordEntryDay ?? 0;
  state.districts = state.districts ?? defaultDistrictPartition(state.config);
  state.cohorts = state.cohorts ?? {};
  // Cohorts saved before the demand engine landed carry no urgency buckets;
  // seed them at the baseline default (no-op for Village saves — empty map).
  for (const cid in state.cohorts) {
    const co = state.cohorts[cid]!;
    co.needBuckets = co.needBuckets ?? seedNeedBuckets(state.config.sizePreset);
    co.dayEvents = co.dayEvents ?? { fulfilled: 0, unmet: 0, pricedOut: 0 };
  }
  state.lastLapsedFireSale = state.lastLapsedFireSale ?? null;
  // Prosperity tiers: pre-tier saves get a one-shot snapshot guess (no
  // streak history), then TierSystem takes over with hysteresis.
  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    if (cit.tier === undefined) {
      cit.tierStreak = 0;
      cit.tier = 'worker';
      cit.tier = snapshotTier(state, cit);
    }
    cit.tierStreak = cit.tierStreak ?? 0;
  }
  state.config.maxHomes = state.config.maxHomes ?? 40;
  state.config.maxCitizens = state.config.maxCitizens ?? 80;
  state.config.playerStartCash = state.config.playerStartCash ?? 15000 * 100;
  state.config.worldEventDailyChance = state.config.worldEventDailyChance ?? 0.2;
  state.config.aiExpandChance = state.config.aiExpandChance ?? 0.5;
  let aiSeen = 0;
  for (const id in state.firms) {
    const f = state.firms[id]!;
    // Firm archetype (Arc D1): the versioned v1->v2 migration stamps this on
    // every firm; the defensive fill covers any save that reaches here without
    // it (e.g. a hand-rolled fixture) — every firm today is an operator.
    f.strategy.archetype = f.strategy.archetype ?? 'operator';
    f.brandByProduct = f.brandByProduct ?? {};
    f.adBudgetByProduct = f.adBudgetByProduct ?? {};
    f.qualityByProduct = f.qualityByProduct ?? {};
    f.debt = f.debt ?? 0;
    f.interestRatePerDay = f.interestRatePerDay ?? 0.0009;
    f.sharesHeld = f.sharesHeld ?? {};
    f.shareCostBasis = f.shareCostBasis ?? {};
    f.acquiredNames = f.acquiredNames ?? [];
    f.autoPriceByProduct = f.autoPriceByProduct ?? {};
    f.exportRevenue = f.exportRevenue ?? 0;
    f.exportRevenueByCity = f.exportRevenueByCity ?? {};
    f.wholesaleSpend = f.wholesaleSpend ?? 0;
    f.wholesaleEarned = f.wholesaleEarned ?? 0;
    f.managers = f.managers ?? [];
    f.forwards = f.forwards ?? [];
    f.forwardWins = f.forwardWins ?? 0;
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
      serviceExpense: d.serviceExpense ?? 0,
      rentExpense: d.rentExpense ?? 0,
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
      serviceExpense: d.serviceExpense ?? 0,
      rentExpense: d.rentExpense ?? 0,
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
    // Preset-gated (C1): a Village save never gains a City-only need, so
    // loading it stays byte-identical; a City save backfills the breadth needs.
    for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
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
    f.crowdByCohort = f.crowdByCohort ?? {};
    f.crowdTenants = f.crowdTenants ?? 0;
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
    f.positioning = f.positioning ?? 'standard';
    // Multi-product retail: wrap the legacy single retailProductId.
    if (!Array.isArray(f.retailProductIds)) {
      const legacy = (f as unknown as { retailProductId?: string | null }).retailProductId;
      f.retailProductIds = legacy ? [legacy] : [];
      delete (f as unknown as { retailProductId?: string | null }).retailProductId;
    }
  }
  // ...and give the market a stat entry for them (preset-gated so a Village
  // save never grows a City-only product key — see startingScenario).
  for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
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
    for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
      state.tradeCities[cid]!.pricesByProduct[pid] =
        state.tradeCities[cid]!.pricesByProduct[pid] ??
        Math.round(getProduct(pid).basePrice * cityBias(cid, pid));
    }
  }

  // Stakes bought before cost-basis tracking existed: mark their basis at
  // today's price (all firms are migrated by now, so marketCap is valid).
  // Realized gains on these start counting from the load, not from zero.
  for (const fid of Object.keys(state.firms).sort()) {
    const firm = state.firms[fid]!;
    for (const tid in firm.sharesHeld) {
      if (firm.shareCostBasis[tid] === undefined) {
        firm.shareCostBasis[tid] = Math.round(
          ((firm.sharesHeld[tid] ?? 0) * marketCap(state, tid)) / 100,
        );
      }
    }
  }
  return state;
}
