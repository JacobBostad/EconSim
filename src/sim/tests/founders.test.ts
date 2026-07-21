import { describe, it, expect } from 'vitest';
import { ticksPerDay } from '../core/Tick';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import type { GameState } from '../core/GameState';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { runAIFounderSystem, founderRoll, founderMaxAiFirms } from '../systems/AIFounderSystem';
import {
  FOUNDER_EARLIEST_DAY,
  FOUNDER_GAP_DAYS,
  FOUNDER_UNDERSUPPLY_COOLDOWN,
} from '../data/constants';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import type { MarketDaySnapshot } from '../entities/Market';
import { serialize, deserialize } from '../persistence/saveLoad';
import { morningBriefing } from '../selectors/advisorSelectors';

/** Drive the founder system directly at day boundaries with citizens pinned
 * prosperous — no other systems run, so the gates are exactly what we set. */
function runFounderDays(state: GameState, days: number, satisfaction = 70): void {
  const tpd = ticksPerDay(state.config);
  for (let i = 0; i < days; i++) {
    state.tick += tpd - (state.tick % tpd || tpd) + tpd;
    for (const c of Object.values(state.citizens)) c.satisfaction = satisfaction;
    runAIFounderSystem(makeContext(state));
  }
}

const aiCount = (s: GameState) =>
  Object.values(s.firms).filter((f) => f.ownerType === 'ai').length;

describe('AI founders', () => {
  it('tracks market gaps daily and resets them when a seller appears', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    runFounderDays(state, 3);
    expect(state.marketGapDays['bread']).toBe(3);
    expect(state.marketGapDays['tools']).toBe(3);

    const sim = new Simulation(state);
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    runFounderDays(state, 1);
    expect(state.marketGapDays['bread']).toBe(0); // the player serving it resets the gap
    expect(state.marketGapDays['tools']).toBe(4);
  });

  it('nobody founds before the first-mover window closes', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    // Gates all open except the calendar: gaps deep, town pinned prosperous.
    for (const pid of ['bread', 'tools', 'clothes']) state.marketGapDays[pid] = 99;
    runFounderDays(state, FOUNDER_EARLIEST_DAY - 10);
    expect(aiCount(state)).toBe(0);
  });

  it('a persistent gap in a thriving town gets filled — conserved, staffed, announced', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    const supply0 = totalMoneySupply(state);
    for (const pid of ['bread', 'tools', 'clothes']) state.marketGapDays[pid] = FOUNDER_GAP_DAYS;
    runFounderDays(state, FOUNDER_EARLIEST_DAY + 30);
    expect(aiCount(state)).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
    const firm = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    expect(firm.ceoName).toBeTruthy();
    expect(firm.personalityId).toBeTruthy();
    expect(firm.facilities.length).toBe(3); // producer, factory, store
    const store = firm.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'retail')!;
    expect(store.retailProductIds).toEqual(['bread']); // first gap in fixed order
    expect(store.employees.length).toBeGreaterThan(0);
    expect(state.events.some((e) => e.message.includes('📰 New competition'))).toBe(true);
    expect(state.marketGapDays['bread']).toBe(0);
  });

  it('capital does not chase a struggling town', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    for (const pid of ['bread', 'tools', 'clothes']) state.marketGapDays[pid] = 99;
    runFounderDays(state, FOUNDER_EARLIEST_DAY + 30, 50); // below the immigration gate
    expect(aiCount(state)).toBe(0);
  });

  it('the daily roll is deterministic and gap counters survive save/load', () => {
    for (let d = 0; d < 50; d++) expect(founderRoll(11, d)).toBe(founderRoll(11, d));

    const state = createInitialState(11, undefined, 'dust_hollow');
    runFounderDays(state, 5);
    const loaded = deserialize(serialize(state));
    expect(loaded.marketGapDays['bread']).toBe(5);

    // Old saves default the tracker to empty.
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.marketGapDays;
    expect(deserialize(JSON.stringify(raw)).marketGapDays).toEqual({});
  });

  it('the advisor warns about an open staple market, and claiming it clears the warning', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    state.marketGapDays['bread'] = 12; // past half the founder clock
    for (const c of Object.values(state.citizens)) c.satisfaction = 70;
    const warning = morningBriefing(state).find((a) => a.icon === '🏗️');
    expect(warning).toBeDefined();
    expect(warning!.text).toContain(`12/${FOUNDER_GAP_DAYS}`);

    // A staffed player store selling bread claims the market — warning gone.
    const player = state.firms[state.playerFirmId]!;
    player.cash = 40000_00;
    const sim = new Simulation(state);
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    expect(morningBriefing(state).some((a) => a.icon === '🏗️')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Preset caps — the SIZE_PRESETS fields are now read, not dead.
// ---------------------------------------------------------------------------
describe('AI founder — preset scale wiring', () => {
  it('the founder AI-firm cap resolves per preset (village stays exactly 6)', () => {
    expect(founderMaxAiFirms({ ...DEFAULT_CONFIG, sizePreset: 'village' })).toBe(6);
    expect(founderMaxAiFirms({ ...DEFAULT_CONFIG, sizePreset: 'city' })).toBe(
      SIZE_PRESETS.city.founderMaxAiFirms,
    );
    expect(founderMaxAiFirms({ ...DEFAULT_CONFIG, sizePreset: 'metropolis' })).toBe(
      SIZE_PRESETS.metropolis.founderMaxAiFirms,
    );
    expect(SIZE_PRESETS.city.founderMaxAiFirms).toBe(18);
    expect(SIZE_PRESETS.metropolis.founderMaxAiFirms).toBe(30);
  });

  it('createInitialState raises the cast/home ceilings for non-Village presets only', () => {
    const village = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'village' });
    expect(village.config.maxCitizens).toBe(DEFAULT_CONFIG.maxCitizens); // untouched (80)
    expect(village.config.maxHomes).toBe(DEFAULT_CONFIG.maxHomes); // untouched (40)

    const city = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    expect(city.config.maxCitizens).toBe(SIZE_PRESETS.city.castTarget); // 150
    // Homes hold 2, plus a few spares for odd/partial fills.
    expect(city.config.maxHomes).toBe(Math.ceil(SIZE_PRESETS.city.castTarget / 2) + 4);
  });
});

// ---------------------------------------------------------------------------
// City under-supply signal — capital answers a persistent paying shortage in
// an OCCUPIED market. Village must be structurally immune (referee: the whole
// suite above, which runs at Village size, must stay green).
// ---------------------------------------------------------------------------

/** Overwrite a product's finalized history with `days` of a fixed fill-rate so
 * the founder loop reads a persistent shortage — nothing else touches history
 * in these driver-only harnesses. */
function pinShortage(state: GameState, pid: string, sold: number, unmet: number, days = 20): void {
  const stat = state.marketStats[pid]!;
  const snaps: MarketDaySnapshot[] = [];
  for (let d = 0; d < days; d++) {
    snaps.push({
      day: d,
      averagePrice: 100,
      unitsSold: sold,
      unmetDemand: unmet,
      totalInventory: 0,
      sharesByFirm: {},
      tradePrice: 0,
    });
  }
  stat.history = snaps;
}

/** Drive only the founder system at day boundaries, holding the whole town's
 * satisfaction below the immigration ceiling so the total-VACANCY path (which
 * keeps that gate) never fires — isolating the under-supply path. */
function runFounderDaysMiserable(state: GameState, days: number): void {
  const tpd = ticksPerDay(state.config);
  for (let i = 0; i < days; i++) {
    state.tick += tpd - (state.tick % tpd || tpd) + tpd;
    for (const c of Object.values(state.citizens)) c.satisfaction = 30;
    for (const cid in state.cohorts) state.cohorts[cid]!.avgSatisfaction = 30;
    runAIFounderSystem(makeContext(state));
  }
}

describe('AI founder — city under-supply entry', () => {
  it('a persistent bread shortage draws a founder into the occupied market — conserved', () => {
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const supply0 = totalMoneySupply(state);
    const startAi = aiCount(state);
    expect(startAi).toBeGreaterThan(0); // City opens with incumbent bakeries
    // Bread is SOLD (occupied) but chronically starved: ~45% fill.
    pinShortage(state, 'bread', 300, 400);

    // Nobody enters before the first-mover window closes, even mid-shortage.
    runFounderDaysMiserable(state, FOUNDER_EARLIEST_DAY - 5);
    expect(aiCount(state)).toBe(startAi);

    // ...then within the ~60-120 day window a competitor moves in on bread.
    runFounderDaysMiserable(state, 70);
    expect(aiCount(state)).toBeGreaterThan(startAi);
    expect(totalMoneySupply(state)).toBe(supply0); // founding capital is conserved
    // The newest AI firm sells bread and was announced as an under-supply entry.
    const bakerySellers = Object.values(state.firms).filter(
      (f) => f.ownerType === 'ai' && f.facilities.some((fid) => {
        const fac = state.facilities[fid];
        return !!fac && fac.retailProductIds.includes('bread');
      }),
    );
    expect(bakerySellers.length).toBeGreaterThan(1); // more bread sellers than before
    expect(
      state.events.some((e) => e.message.includes("shelves can't keep up")),
    ).toBe(true);
  });

  it('under-supply entries are rate-limited town-wide (one per cooldown)', () => {
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    pinShortage(state, 'bread', 300, 400);
    // Get past the first-mover window and let the first entry land.
    runFounderDaysMiserable(state, FOUNDER_EARLIEST_DAY + 20);
    const afterFirst = aiCount(state);
    const dayAfterFirst = state.lastUndersupplyEntryDay;
    expect(dayAfterFirst).toBeGreaterThan(0);

    // Within the cooldown, the still-present shortage must NOT spawn a second.
    runFounderDaysMiserable(state, FOUNDER_UNDERSUPPLY_COOLDOWN - 2);
    expect(aiCount(state)).toBe(afterFirst);
    expect(state.lastUndersupplyEntryDay).toBe(dayAfterFirst);

    // Past the cooldown (shortage persists), one more may enter.
    runFounderDaysMiserable(state, 6);
    expect(aiCount(state)).toBeGreaterThanOrEqual(afterFirst);
    expect(state.lastUndersupplyEntryDay).toBeGreaterThan(dayAfterFirst);
  });

  it('Village never accumulates the under-supply streak, even under a shortage', () => {
    const state = createInitialState(11, undefined, 'dust_hollow'); // Village
    pinShortage(state, 'bread', 300, 400);
    const startAi = aiCount(state);
    runFounderDaysMiserable(state, FOUNDER_EARLIEST_DAY + 60);
    // The streak counter is never touched at Village size...
    expect(state.marketUndersupplyDays['bread'] ?? 0).toBe(0);
    // ...and no under-supply entry ever occurs (the miserable town also fails
    // the vacancy path's satisfaction gate, so nothing founds at all).
    expect(aiCount(state)).toBe(startAi);
    expect(state.lastUndersupplyEntryDay).toBe(0);
  });

  it('the crowd-scale sim closes the bread shortage (founders enter, fill-rate recovers)', () => {
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const startAi = aiCount(state);
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 130); // 130 crowd-running days

    // Founders answered the shortage: more AI firms than the City opened with.
    expect(aiCount(state)).toBeGreaterThan(startAi);

    // Bread fill-rate over the last 14 finalized days has recovered well above
    // the ~0.5 baseline the un-wired loop plateaued at (city-soak finding (a)).
    // The bar sits AT the under-supply founder trigger (0.65): the worker
    // catch-up (a fixed WORKER_CATCHUP_BASKETS top-up per urgent-need visit)
    // makes the cast's TRUE staple demand visible, which grows the demand
    // denominator and settles equilibrium fill near ~0.67 instead of ~0.72 —
    // but an equilibrium BELOW the trigger would mean founders never stop
    // firing, so the trigger is the honest floor.
    const hist = state.marketStats['bread']!.history;
    let sold = 0, unmet = 0;
    for (let i = Math.max(0, hist.length - 14); i < hist.length; i++) {
      sold += hist[i]!.unitsSold;
      unmet += hist[i]!.unmetDemand;
    }
    const fillRate = sold / (sold + unmet);
    expect(fillRate).toBeGreaterThan(0.65);
    expect(totalMoneySupply(state)).toBe(supply0); // money conserved across the run
  });
});

// ---------------------------------------------------------------------------
// Metropolis founder scale-up (A5) — the 30-firm cap actually HAPPENS, and the
// scale-up is solvent. The founder-scale probe measured the pre-A5 loop stuck at
// 5-6 firms on Metropolis (the world-cash gate blocked ~200/300 days while a
// screaming shortage went unanswered); after the A5 pacing fixes it fills to
// ~24-30. One seed / 250 crowd-running days: a full-sim Metropolis run is the
// suite's heaviest (~3.5s of engine work — the 10k-cohort crowd plus 25+ firms),
// so this pins the achievement at a single representative seed rather than
// paying that cost three times. City coverage stays with the shortage test above.
// ---------------------------------------------------------------------------
describe('AI founder — metropolis scale-up (A5)', () => {
  it('fills toward the 30-firm cap with a solvent field and no silent placement abort', () => {
    const state = createInitialState(7, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const startAi = aiCount(state);
    const storeCount = () =>
      Object.values(state.facilities).filter((f) => f.retailProductIds.length > 0).length;
    const startStores = storeCount();
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 250);

    // Scale-up: the founders answered the crowd's shortage in force — far past
    // the pre-A5 5-6 ceiling and into the 25+ band the cap now supports. The bar
    // (22) sits well under the ~27 this seed reaches, so ordinary drift can't
    // flake it, while still proving the metropolis-class fill (a City tops out
    // near 13, a Village at 6).
    const ai = aiCount(state);
    expect(ai).toBeGreaterThanOrEqual(22);
    expect(ai).toBeLessThanOrEqual(SIZE_PRESETS.metropolis.founderMaxAiFirms); // never exceeds the cap

    // No silent placement abort: foundFirm dissolves a firm whose chain can't be
    // built (returns the capital and deletes it), so every surviving AI firm must
    // carry a real, fully-built chain — a retail store to sell from and its
    // producer+factory behind it. A store-less or partial firm would mean a build
    // that half-failed; there are none.
    for (const f of Object.values(state.firms)) {
      if (f.ownerType !== 'ai') continue;
      const facs = f.facilities.map((id) => state.facilities[id]!).filter(Boolean);
      expect(facs.some((fac) => fac.type === 'retail')).toBe(true);
      expect(facs.length).toBeGreaterThanOrEqual(3); // producer + factory + store
    }
    // The store count grew with the firm count — the district commercial slots
    // absorbed every founding without running out of ground.
    expect(storeCount()).toBeGreaterThan(startStores + 15);
    expect(ai).toBeGreaterThan(startAi);

    // Solvent scale-up: 25+ firms competing must NOT cascade into mass insolvency
    // (the A5 founding-runway + solvency-brake work). No AI firm is insolvent at
    // day 250, and the founding capital stayed conserved to the cent throughout.
    const insolvent = Object.values(state.firms).filter(
      (f) => f.ownerType === 'ai' && f.bankruptcyStatus === 'insolvent',
    ).length;
    expect(insolvent).toBe(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
