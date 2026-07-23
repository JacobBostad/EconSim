/**
 * regionScheduler.test.ts — the TownScheduler + the ticking partner (region.md
 * step 4, slice 3). Pins the slice's binding acceptance:
 *
 *  - flag OFF ⇒ ONE town, ONE schedule, exactly today's rng draws: the pinned
 *    baselines hold (village 11 + city 11 rngState/money) with the scheduler in
 *    place — the flag-off identity argument, as a test;
 *  - flag ON ⇒ the partner SIMULATES: its cohort consumes (cashPool moves,
 *    purchases recorded), its firms produce (output turns over, cash changes),
 *    its book updates (marketStats carry live sales) — over a 60-day City run;
 *  - REGION-WIDE conservation to the cent EVERY day (the two-town conservation
 *    property, also shipped as docs/design/probes/two-town-conservation.ts);
 *  - home ISOLATION: a live partner leaves home's rngState + `towns.home`
 *    byte-identical to a flag-off run (the partner draws no shared rng);
 *  - DETERMINISM: two flag-on runs agree bit-for-bit.
 */

import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import type { SimulationConfig } from '../core/SimulationConfig';
import { totalMoneySupply } from '../core/GameState';
import { HOME_TOWN_ID } from '../core/Town';
import type { TownRecords } from '../core/Town';
import { PARTNER_TOWN_ID } from '../data/seedTown';
import { ticksPerDay } from '../core/Tick';
import { normalizedSerialize } from './helpers';

function cityConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
  };
}
function regionConfig(): SimulationConfig {
  return { ...cityConfig(), regionEnabled: true };
}

function townCash(r: TownRecords): number {
  let sum = 0;
  for (const id in r.firms) sum += r.firms[id]!.cash;
  for (const id in r.cohorts) sum += r.cohorts[id]!.cashPool;
  for (const id in r.citizens) sum += r.citizens[id]!.cash;
  return sum;
}

describe('Region slice 3 — flag-off identity (one town, one schedule)', () => {
  it('a plain City seed 11 reproduces its pinned rngState + money with the scheduler', () => {
    // The flag-off identity argument, as a test: `sortedTownIds` is `['home']`,
    // so the scheduler runs exactly the full SYSTEMS list once, in today's order.
    const s = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 300);
    expect(s.rngState).toBe(2546912297);
    expect(totalMoneySupply(s)).toBe(316900000);
    expect(Object.keys(s.towns)).toEqual([HOME_TOWN_ID]);
  });

  it('a Village seed 11 reproduces its pinned 300-day rngState with the scheduler', () => {
    const s = createInitialState(11); // default = village
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 300);
    expect(s.rngState).toBe(3274842624);
  });
});

describe('Region slice 3 — the partner SIMULATES (60-day City, flag on)', () => {
  const DAYS = 60;

  it('cohort consumes, firms produce, book updates — conserved every day', () => {
    const on = createInitialState(11, regionConfig());
    const partner = on.towns[PARTNER_TOWN_ID]!;
    const cohort = Object.values(partner.cohorts)[0]!;
    const pool0 = cohort.cashPool;
    const firmCash0 = Object.values(partner.firms).reduce((n, f) => n + f.cash, 0);
    const money0 = totalMoneySupply(on);

    const sim = new Simulation(on);
    sim.dispatch({ type: 'RESUME' });
    // Conservation to the cent EVERY day (region-wide money primitive).
    for (let d = 0; d < DAYS; d++) {
      sim.run(ticksPerDay(on.config));
      expect(totalMoneySupply(on)).toBe(money0);
    }

    // Its cohort CONSUMED: cashPool moved and purchases were recorded.
    expect(cohort.cashPool).not.toBe(pool0);
    // The shared world ledger carries BOTH towns' crowd purchases; the PARTNER's
    // are the ones from its region-unique, namespaced cohort id.
    const partnerBuys = on.transactions.filter(
      (t) =>
        t.from.kind === 'cohort' &&
        t.category === 'revenue' &&
        t.note.startsWith('Crowd bought') &&
        t.from.id!.startsWith(`${PARTNER_TOWN_ID}:`),
    );
    expect(partnerBuys.length).toBeGreaterThan(0);

    // Its firms PRODUCED: at least one factory turned inputs into output, and
    // firm cash changed (variable cost + wages out, retail revenue in).
    const factories = Object.values(partner.facilities).filter((f) => f.type === 'factory');
    const anyOutput = factories.some(
      (f) => Object.values(f.outputInventory).some((s) => s.quantity > 0),
    );
    expect(anyOutput).toBe(true);
    const firmCashN = Object.values(partner.firms).reduce((n, f) => n + f.cash, 0);
    expect(firmCashN).not.toBe(firmCash0);
    // The firm P&L ledger populated region-wide (the recordTransaction fix).
    const anyLedger = Object.values(partner.firms).some(
      (f) => f.accounting.lifetime.revenue > 0 || f.accounting.lifetime.wages > 0,
    );
    expect(anyLedger).toBe(true);

    // Its BOOK updated: some product carries live sales history.
    const soldProducts = Object.values(partner.marketStats).filter((st) =>
      st.history.some((h) => h.unitsSold > 0),
    );
    expect(soldProducts.length).toBeGreaterThan(0);
  });

  it('home stays byte-isolated with the partner live (rngState + towns.home)', () => {
    const off = createInitialState(11, cityConfig());
    const on = createInitialState(11, regionConfig());
    const offSim = new Simulation(off);
    const onSim = new Simulation(on);
    offSim.dispatch({ type: 'RESUME' });
    onSim.dispatch({ type: 'RESUME' });
    offSim.run(ticksPerDay(off.config) * DAYS);
    onSim.run(ticksPerDay(on.config) * DAYS);
    expect(on.rngState).toBe(off.rngState);
    expect(JSON.stringify(on.towns[HOME_TOWN_ID])).toBe(JSON.stringify(off.towns[HOME_TOWN_ID]));
    // Home holder cash unchanged (world cash legitimately diverges — shared).
    expect(townCash(on.towns[HOME_TOWN_ID]!)).toBe(townCash(off.towns[HOME_TOWN_ID]!));
  });

  it('two flag-on runs agree bit-for-bit (partner + home + rngState)', () => {
    const a = createInitialState(11, regionConfig());
    const b = createInitialState(11, regionConfig());
    const sa = new Simulation(a);
    const sb = new Simulation(b);
    sa.dispatch({ type: 'RESUME' });
    sb.dispatch({ type: 'RESUME' });
    sa.run(ticksPerDay(a.config) * DAYS);
    sb.run(ticksPerDay(b.config) * DAYS);
    expect(a.rngState).toBe(b.rngState);
    expect(JSON.stringify(a.towns[PARTNER_TOWN_ID])).toBe(JSON.stringify(b.towns[PARTNER_TOWN_ID]));
    expect(normalizedSerialize(a)).toBe(normalizedSerialize(b));
  });
});
