/**
 * townSeam.test.ts — the region's town seam (region.md step 3, ENDGAME).
 *
 * The six town-scoped record families now LIVE at `state.towns[HOME_TOWN_ID]`
 * (option (c), "records genuinely MOVE"). The flat paths (`state.firms`, ...)
 * survive as non-enumerable accessor aliases onto the home town, so every
 * converted reader and every un-converted writer keeps working against the same
 * live objects, while a save serializes ONLY the `towns` key. These tests pin:
 *
 *   1. accessor identity — `townOf(...).firms === state.firms
 *      === state.towns.home.firms` (all the same reference);
 *   2. the seam threads — `makeContext(state).townId === HOME_TOWN_ID`;
 *   3. the INVARIANT FLIP (was: "no towns key in a save") — a save now HAS the
 *      `towns` key, does NOT carry the six flat keys, and is SAVE_VERSION 3;
 *   4. an OLD-shape save (flat records, no towns key) migrates into
 *      `towns.home` on load and round-trips.
 *
 * and that the district, cohort, citizen, marketStats, firms, AND facilities
 * families, run through the converted systems, stay deterministic (two City runs
 * agree bit-for-bit on the districts, cohorts, citizens, market book, firm
 * cash/valuation, every facility's inventory/level/dailyStats, and rngState).
 * Bit-identity against the pre-refactor pinned baselines is the orchestrator's
 * job (village seeds 11/4/7 rngState pins, city seed 11) — this file guards the
 * accessor's contract, not the whole trajectory.
 */

import { describe, it, expect } from 'vitest';
import { normalizedSerialize } from './helpers';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { makeContext, SAVE_VERSION } from '../core/GameState';
import { townOf, HOME_TOWN_ID, TOWN_RECORD_KEYS } from '../core/Town';
import { ticksPerDay } from '../core/Tick';
import { serialize, deserialize } from '../persistence/saveLoad';
import { companyValuation } from '../selectors/companySelectors';

/** A running City-preset sim (crowd cohorts + districts live), resumed. */
function newCitySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Town seam — accessor is a view over the flat records (region.md step 3)', () => {
  it('townOf(state,"home") returns the SAME record objects as the flat paths', () => {
    const state = newCitySim(11).getState();
    const town = townOf(state, HOME_TOWN_ID);
    // The endgame identity chain: the view, the flat alias, and the stored home
    // town record are all the SAME object — a converted call site is identical.
    const home = state.towns[HOME_TOWN_ID]!;
    expect(town.districts).toBe(state.districts);
    expect(town.cohorts).toBe(state.cohorts);
    expect(town.citizens).toBe(state.citizens);
    expect(town.marketStats).toBe(state.marketStats);
    expect(town.firms).toBe(state.firms);
    expect(town.facilities).toBe(state.facilities);
    expect(state.firms).toBe(home.firms);
    expect(state.citizens).toBe(home.citizens);
    expect(state.districts).toBe(home.districts);
    expect(state.cohorts).toBe(home.cohorts);
    expect(state.marketStats).toBe(home.marketStats);
    expect(state.facilities).toBe(home.facilities);
    // Map dimensions are scalars, not records: the getter returns the same value
    // the flat config holds, so a converted placement/renderer read is identical.
    expect(town.mapWidth).toBe(state.config.mapWidth);
    expect(town.mapHeight).toBe(state.config.mapHeight);
    expect(town.id).toBe('home');
  });

  it('the townId argument defaults to the home town (one-town region)', () => {
    const state = newCitySim(11).getState();
    // A bare-`state` helper mid-gradient calls townOf(state) with no id and must
    // resolve to the same records — identity is independent of the argument.
    expect(townOf(state).districts).toBe(state.districts);
    expect(townOf(state).cohorts).toBe(state.cohorts);
    expect(townOf(state).citizens).toBe(state.citizens);
    expect(townOf(state).marketStats).toBe(state.marketStats);
    expect(townOf(state).firms).toBe(state.firms);
    expect(townOf(state).facilities).toBe(state.facilities);
    expect(townOf(state).mapWidth).toBe(state.config.mapWidth);
    expect(townOf(state).mapHeight).toBe(state.config.mapHeight);
    expect(townOf(state, HOME_TOWN_ID).mapWidth).toBe(townOf(state).mapWidth);
    expect(townOf(state, HOME_TOWN_ID).mapHeight).toBe(townOf(state).mapHeight);
    expect(townOf(state).id).toBe('home');
    expect(townOf(state, HOME_TOWN_ID).districts).toBe(townOf(state).districts);
    expect(townOf(state, HOME_TOWN_ID).citizens).toBe(townOf(state).citizens);
    expect(townOf(state, HOME_TOWN_ID).marketStats).toBe(townOf(state).marketStats);
  });

  it('the view tracks the live record even after the economy mutates it', () => {
    const sim = newCitySim(11);
    const town = townOf(sim.getState(), HOME_TOWN_ID);
    sim.run(ticksPerDay(sim.getState().config) * 10);
    // desirability is rewritten daily by the (converted) DistrictSystem; the
    // getter still returns the live object, not a day-0 snapshot.
    expect(town.districts).toBe(sim.getState().districts);
    for (const id of Object.keys(town.districts)) {
      expect(town.districts[id]!.desirability).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Town seam — the context carries the town', () => {
  it('makeContext threads the home town id', () => {
    const state = newCitySim(11).getState();
    expect(makeContext(state).townId).toBe(HOME_TOWN_ID);
    expect(makeContext(state).townId).toBe('home');
  });
});

describe('Town seam — the records MOVED into towns (invariant flip, SAVE_VERSION 3)', () => {
  it('a save carries the "towns" key and NOT the six flat family keys', () => {
    const state = newCitySim(11).getState();
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    // The flip: what used to be forbidden is now the invariant.
    expect('towns' in raw).toBe(true);
    expect(raw.saveVersion).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(3);
    const home = (raw.towns as Record<string, Record<string, unknown>>).home!;
    expect(home).toBeTruthy();
    // The six families serialize UNDER towns.home, and the flat aliases (being
    // non-enumerable) never leak — so no doubling.
    for (const key of TOWN_RECORD_KEYS) {
      expect(key in raw).toBe(false);
      expect(home[key]).toBeTruthy();
      // The absence above is downstream of non-enumerability; assert the
      // property descriptor directly so a refactor that keeps serialization
      // clean by other means but re-exposes the keys to enumeration is caught.
      const desc = Object.getOwnPropertyDescriptor(state, key);
      expect(desc?.enumerable).toBe(false);
      expect(typeof desc?.get).toBe('function');
    }
  });

  it('the towns key persists (and the flat keys stay absent) after a City run', () => {
    const sim = newCitySim(11);
    sim.run(ticksPerDay(sim.getState().config) * 20);
    const raw = JSON.parse(serialize(sim.getState())) as Record<string, unknown>;
    expect('towns' in raw).toBe(true);
    for (const key of TOWN_RECORD_KEYS) expect(key in raw).toBe(false);
  });

  it('an OLD-shape save (flat records, no towns key) migrates into towns.home', () => {
    // Build a pre-move save from a current one: unwrap towns.home to the top
    // level and stamp the pre-endgame SAVE_VERSION (2). This is exactly the byte
    // shape every save written before this slice carries.
    const state = newCitySim(11).getState();
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    const home = (raw.towns as Record<string, Record<string, unknown>>).home!;
    delete raw.towns;
    for (const key of TOWN_RECORD_KEYS) raw[key] = home[key];
    raw.saveVersion = 2;

    const migrated = deserialize(JSON.stringify(raw));
    // The migration wrapped the flat records into the home town...
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.towns[HOME_TOWN_ID]).toBeTruthy();
    // ...the aliases are reinstalled (readers/writers work)...
    expect(migrated.firms).toBe(migrated.towns[HOME_TOWN_ID]!.firms);
    expect(Object.keys(migrated.citizens).length).toBeGreaterThan(0);
    expect(townOf(migrated).firms).toBe(migrated.firms);
    // ...and the re-serialized save is back in the new shape (towns, no flat keys).
    const reraw = JSON.parse(serialize(migrated)) as Record<string, unknown>;
    expect('towns' in reraw).toBe(true);
    for (const key of TOWN_RECORD_KEYS) expect(key in reraw).toBe(false);
    // Round-trip stable: loading the re-serialized save changes nothing.
    expect(serialize(deserialize(serialize(migrated)))).toBe(serialize(migrated));
  });
});

describe('Town seam — the converted district family stays deterministic', () => {
  it('two City runs agree bit-for-bit through the converted district systems', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 30);
    b.run(tpd * 30);
    // rngState and the full serialized state — the district readers now route
    // through townOf, and the run is still reproducible to the byte.
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    // And every district object the converted DistrictSystem wrote is identical.
    const da = a.getState().districts;
    const db = b.getState().districts;
    for (const id of Object.keys(da)) {
      expect(da[id]!.desirability).toBe(db[id]!.desirability);
      expect(da[id]!.landValue).toBe(db[id]!.landValue);
    }
  });
});

describe('Town seam — the converted cohort family stays deterministic', () => {
  it('two City runs agree bit-for-bit through the converted cohort systems', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    // 30 days is enough for the crowd path to run hard: CohortDemand grows
    // buckets and shops, CohortLabor staffs the crowd, CohortSocial gates tiers
    // and migrates, CrowdRent/Payroll move cohort cash. Every cohort reader in
    // those systems now routes through townOf(...).cohorts.
    a.run(tpd * 30);
    b.run(tpd * 30);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));

    // The crowd must actually be live — otherwise the cohort readers never run
    // and this proves nothing. City seed 11 seeds cohorts; assert they carry
    // population and that every cohort field the converted systems write agrees.
    const ca = a.getState().cohorts;
    const cb = b.getState().cohorts;
    const ids = Object.keys(ca).sort();
    expect(ids.length).toBeGreaterThan(0);
    let totalPop = 0;
    for (const id of ids) {
      totalPop += ca[id]!.population;
      expect(ca[id]!.population).toBe(cb[id]!.population);
      expect(ca[id]!.employed).toBe(cb[id]!.employed);
      expect(ca[id]!.cashPool).toBe(cb[id]!.cashPool);
      expect(ca[id]!.avgSatisfaction).toBe(cb[id]!.avgSatisfaction);
    }
    expect(totalPop).toBeGreaterThan(0);
  });
});

describe('Town seam — the converted citizen + marketStats families stay deterministic', () => {
  it('two City runs agree bit-for-bit through the converted citizen/market systems', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    // 30 days runs the cast path hard: CitizenSchedule/Movement walk citizens,
    // RetailDemand shops them, Labor/Payroll/Tier/Satisfaction rewrite their
    // fields, Immigration/CastCurator grow and reshape the cast, and MarketStats
    // finalizes the per-product book daily. Every citizen and marketStats reader
    // in those systems now routes through townOf(...).citizens / .marketStats.
    a.run(tpd * 30);
    b.run(tpd * 30);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));

    // The cast must actually be live — otherwise the citizen readers never run
    // and this proves nothing. City seed 11 seeds a cast; assert it carries
    // population and that every citizen field the converted systems write agrees.
    const za = a.getState().citizens;
    const zb = b.getState().citizens;
    const cids = Object.keys(za).sort();
    expect(cids.length).toBeGreaterThan(0);
    for (const id of cids) {
      expect(za[id]!.cash).toBe(zb[id]!.cash);
      expect(za[id]!.skill).toBe(zb[id]!.skill);
      expect(za[id]!.satisfaction).toBe(zb[id]!.satisfaction);
      expect(za[id]!.employmentStatus).toBe(zb[id]!.employmentStatus);
      expect(za[id]!.tier).toBe(zb[id]!.tier);
    }

    // And the per-product market book the converted MarketStatsSystem rebuilds
    // daily agrees field-for-field, with real sales recorded (readers ran).
    const ma = a.getState().marketStats;
    const mb = b.getState().marketStats;
    const pids = Object.keys(ma).sort();
    expect(pids.length).toBeGreaterThan(0);
    let totalSold = 0;
    for (const pid of pids) {
      totalSold += ma[pid]!.unitsSold;
      expect(ma[pid]!.averagePrice).toBe(mb[pid]!.averagePrice);
      expect(ma[pid]!.unitsSold).toBe(mb[pid]!.unitsSold);
      expect(ma[pid]!.totalInventory).toBe(mb[pid]!.totalInventory);
      expect(ma[pid]!.history.length).toBe(mb[pid]!.history.length);
    }
    expect(ma[pids[0]!]!.history.length).toBeGreaterThan(0);
  });
});

describe('Town seam — the converted firms family stays deterministic', () => {
  it('two City runs agree bit-for-bit through the converted firm systems', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    // 30 days runs the firm path hard: the AI operator/founder loops price,
    // staff, source, expand, invest and found new firms; Payroll/Accounting/
    // Dividend/Finance/Marketing/Bankruptcy/ServiceBilling rewrite every firm's
    // cash and books daily; Logistics/Production/Rent move firm money. Every
    // firm reader in those systems now routes through townOf(...).firms.
    a.run(tpd * 30);
    b.run(tpd * 30);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));

    // The firm sector must actually be live — otherwise the firm readers never
    // run and this proves nothing. City seed 11 seeds AI firms (and the founder
    // loop mints more over 30 days); assert the book is non-empty and that every
    // firm's cash AND its computed valuation agree run-to-run.
    const fa = a.getState().firms;
    const fb = b.getState().firms;
    const fids = Object.keys(fa).sort();
    expect(fids).toEqual(Object.keys(fb).sort()); // the same firms were founded
    expect(fids.length).toBeGreaterThan(0);
    let totalCash = 0;
    for (const id of fids) {
      totalCash += fa[id]!.cash;
      expect(fa[id]!.cash).toBe(fb[id]!.cash);
      expect(fa[id]!.debt).toBe(fb[id]!.debt);
      // Valuation reads the firm's book, facilities, and equity portfolio —
      // exercising the converted firm readers end-to-end.
      expect(companyValuation(a.getState(), id).valuation).toBe(
        companyValuation(b.getState(), id).valuation,
      );
    }
    // A City seed-11 firm sector holds real cash after 30 days (the readers ran).
    expect(totalCash).not.toBe(0);
  });
});

describe('Town seam — the converted facilities family stays deterministic', () => {
  it('two City runs agree bit-for-bit through the converted facility systems', () => {
    const a = newCitySim(11);
    const b = newCitySim(11);
    const tpd = ticksPerDay(a.getState().config);
    // 30 days runs the building path hard: Production/Inventory rebuild every
    // facility's stock, Logistics/Forward/TradeCity move goods in and out,
    // Labor/CohortLabor staff them (presentWorkers/dailyStats), Retail/CohortDemand
    // sell off the shelves, Accounting snapshots dailyStats→yesterdayStats, the AI
    // operator/landlord/service loops build, upgrade and level them, and
    // Bankruptcy/FireSale close or sell them. Every facility reader in those
    // systems now routes through townOf(...).facilities.
    a.run(tpd * 30);
    b.run(tpd * 30);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));

    // The building stock must actually be live — otherwise the facility readers
    // never run and this proves nothing. City seed 11 seeds facilities (and the
    // AI build loops add more over 30 days); assert the book is non-empty and that
    // every facility's level, status, dailyStats, and both inventories agree
    // run-to-run.
    const ga = a.getState().facilities;
    const gb = b.getState().facilities;
    const gids = Object.keys(ga).sort();
    expect(gids).toEqual(Object.keys(gb).sort()); // the same facilities exist
    expect(gids.length).toBeGreaterThan(0);
    let totalStock = 0;
    let totalSold = 0;
    for (const id of gids) {
      const fa = ga[id]!;
      const fb = gb[id]!;
      expect(fa.level).toBe(fb.level);
      expect(fa.status).toBe(fb.status);
      expect(fa.presentWorkers).toBe(fb.presentWorkers);
      // dailyStats is the per-facility ledger the converted readers write and read;
      // yesterdayStats is the snapshot AccountingSystem folds it into at the day
      // boundary (30 full days lands on one, so dailyStats is freshly reset — the
      // completed day's real sales live in yesterdayStats).
      expect(fa.dailyStats.unitsSold).toBe(fb.dailyStats.unitsSold);
      expect(fa.dailyStats.unitsProduced).toBe(fb.dailyStats.unitsProduced);
      expect(fa.dailyStats.lostSales).toBe(fb.dailyStats.lostSales);
      expect(fa.dailyStats.revenue).toBe(fb.dailyStats.revenue);
      expect(fa.yesterdayStats.unitsSold).toBe(fb.yesterdayStats.unitsSold);
      expect(fa.yesterdayStats.revenue).toBe(fb.yesterdayStats.revenue);
      // Both inventories, compared structurally (the same stacks, same qualities).
      expect(JSON.stringify(fa.inputInventory)).toBe(JSON.stringify(fb.inputInventory));
      expect(JSON.stringify(fa.outputInventory)).toBe(JSON.stringify(fb.outputInventory));
      for (const inv of [fa.inputInventory, fa.outputInventory]) {
        for (const pid in inv) totalStock += inv[pid]!.quantity;
      }
      totalSold += fa.yesterdayStats.unitsSold;
    }
    // A City seed-11 town holds real stock on its shelves and has moved units
    // through them after 30 days — the facility readers demonstrably ran live.
    expect(totalStock).toBeGreaterThan(0);
    expect(totalSold).toBeGreaterThan(0);
  });
});
