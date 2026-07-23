/**
 * regionSeed.test.ts — the region town factory + the flag (region.md step 4,
 * slice 1). Pins the slice's acceptance criteria:
 *
 *  - flag OFF (default) ⇒ a one-town region: no `port_rosa` key, and a City home
 *    is byte-identical to before the slice (the pinned baselines are guarded by
 *    the orchestrator's village-11/city-11 rngState pins; here we pin the shape);
 *  - the FACTORY (`seedTown`) mints ONLY the six town families off the region's
 *    SHARED idCounters with town-namespaced ids (region-unique, home's `firm`/
 *    `fac` counters untouched), draws NOTHING from the shared rng, holds real
 *    cash, is crowd-only (empty cast), and carries its OWN per-town map dims;
 *  - flag ON ⇒ the partner materializes but is INERT: a 30-day City run has
 *    home's rngState / serialized-home / flat money IDENTICAL to flag-off (the
 *    isolation probe's property, as a test), and two flag-on runs agree
 *    bit-for-bit (determinism);
 *  - per-town map dims: `townOf(state).mapWidth === state.config.mapWidth` for
 *    home (the getter swap is value-identity), and the partner carries its own.
 */

import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import type { SimulationConfig } from '../core/SimulationConfig';
import { totalMoneySupply } from '../core/GameState';
import { townOf, HOME_TOWN_ID } from '../core/Town';
import type { TownRecords } from '../core/Town';
import { seedTown, PARTNER_TOWN_ID, PORT_ROSA_SPEC } from '../data/seedTown';
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

/** Sum of a town's holder cash (cohort pools + firm cash). */
function townCash(r: TownRecords): number {
  let sum = 0;
  for (const id in r.firms) sum += r.firms[id]!.cash;
  for (const id in r.cohorts) sum += r.cohorts[id]!.cashPool;
  for (const id in r.citizens) sum += r.citizens[id]!.cash;
  return sum;
}

describe('Region slice 1 — the flag is off by default (byte-identical world)', () => {
  it('DEFAULT_CONFIG.regionEnabled is false', () => {
    expect(DEFAULT_CONFIG.regionEnabled).toBe(false);
  });

  it('a flag-off City game is a ONE-town region (no partner key)', () => {
    const s = createInitialState(11, cityConfig());
    expect(Object.keys(s.towns)).toEqual([HOME_TOWN_ID]);
    expect(s.towns[PARTNER_TOWN_ID]).toBeUndefined();
  });

  it('Village never seeds a partner even if the flag is forced on', () => {
    // A Village is definitionally one town (double-gated on sizePreset).
    const s = createInitialState(11, { ...DEFAULT_CONFIG, regionEnabled: true });
    expect(Object.keys(s.towns)).toEqual([HOME_TOWN_ID]);
  });
});

describe('Region slice 1 — per-town map dims (getter swap is value-identity for home)', () => {
  it('townOf(home).mapWidth/Height equal config, at Village and City', () => {
    for (const preset of ['village', 'city'] as const) {
      const s = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: preset });
      expect(townOf(s).mapWidth).toBe(s.config.mapWidth);
      expect(townOf(s).mapHeight).toBe(s.config.mapHeight);
      // The record field carries it (not a config delegate anymore).
      expect(s.towns[HOME_TOWN_ID]!.mapWidth).toBe(s.config.mapWidth);
      expect(s.towns[HOME_TOWN_ID]!.mapHeight).toBe(s.config.mapHeight);
    }
  });
});

describe('Region slice 1 — the factory (seedTown) mints only town-scoped records', () => {
  it('mints region-unique, town-namespaced ids off the SHARED counters', () => {
    const s = createInitialState(11, cityConfig()); // flag off — no partner yet
    const homeFirmKeysBefore = Object.keys(s.towns[HOME_TOWN_ID]!.firms).sort();
    const firmCounterBefore = s.idCounters['firm'];
    const facCounterBefore = s.idCounters['fac'];

    const partner = seedTown(s, PARTNER_TOWN_ID, PORT_ROSA_SPEC);

    // Attached under the partner key; home records unchanged.
    expect(s.towns[PARTNER_TOWN_ID]).toBe(partner);
    expect(Object.keys(s.towns[HOME_TOWN_ID]!.firms).sort()).toEqual(homeFirmKeysBefore);
    // Home's own `firm`/`fac` counters are UNTOUCHED (partner used namespaced
    // keys), so home's runtime id stream never shifts.
    expect(s.idCounters['firm']).toBe(firmCounterBefore);
    expect(s.idCounters['fac']).toBe(facCounterBefore);
    // The partner minted off the SHARED counters object under its own keys.
    expect(s.idCounters[`${PARTNER_TOWN_ID}:firm`]).toBeGreaterThan(0);
    // Ids are region-unique: partner firm/facility ids collide with nothing in home.
    for (const id of Object.keys(partner.firms)) {
      expect(id.startsWith(`${PARTNER_TOWN_ID}:`)).toBe(true);
      expect(s.towns[HOME_TOWN_ID]!.firms[id]).toBeUndefined();
    }
    for (const id of Object.keys(partner.facilities)) {
      expect(s.towns[HOME_TOWN_ID]!.facilities[id]).toBeUndefined();
    }
  });

  it('is crowd-only (no cast), holds real cash, and carries its own map dims', () => {
    const s = createInitialState(11, cityConfig());
    const partner = seedTown(s, PARTNER_TOWN_ID, PORT_ROSA_SPEC);
    // Crowd-only: cohorts with population, an EMPTY simulated cast.
    expect(Object.keys(partner.citizens).length).toBe(0);
    const pop = Object.values(partner.cohorts).reduce((n, c) => n + c.population, 0);
    expect(pop).toBe(PORT_ROSA_SPEC.crowdPopulation);
    // A handful of producing firms, each with a factory holding output stock.
    expect(Object.keys(partner.firms).length).toBe(PORT_ROSA_SPEC.producerFirms);
    expect(Object.keys(partner.facilities).length).toBe(PORT_ROSA_SPEC.producerFirms);
    const anyOutput = Object.values(partner.facilities).some(
      (f) => Object.keys(f.outputInventory).length > 0,
    );
    expect(anyOutput).toBe(true);
    // Holds real money (cohort pools + firm cash).
    expect(townCash(partner)).toBeGreaterThan(0);
    // Its OWN map dims — the partner preset's authored size, not home's.
    const preset = SIZE_PRESETS[PORT_ROSA_SPEC.sizePreset];
    expect(partner.mapWidth).toBe(preset.mapWidth);
    expect(partner.mapHeight).toBe(preset.mapHeight);
    expect(townOf(s, PARTNER_TOWN_ID).mapWidth).toBe(preset.mapWidth);
    expect(Object.keys(partner.marketStats).length).toBeGreaterThan(0);
  });

  it('draws NOTHING from the shared rng and touches no world-scoped field', () => {
    const s = createInitialState(11, cityConfig());
    const rngBefore = s.rngState;
    const worldBefore = s.worldCash;
    seedTown(s, PARTNER_TOWN_ID, PORT_ROSA_SPEC);
    expect(s.rngState).toBe(rngBefore); // local rng only
    expect(s.worldCash).toBe(worldBefore); // partner cash is minted, not drawn
  });

  it('is deterministic — two seedings agree bit-for-bit', () => {
    const a = createInitialState(11, cityConfig());
    const b = createInitialState(11, cityConfig());
    const pa = seedTown(a, PARTNER_TOWN_ID, PORT_ROSA_SPEC);
    const pb = seedTown(b, PARTNER_TOWN_ID, PORT_ROSA_SPEC);
    expect(JSON.stringify(pa)).toBe(JSON.stringify(pb));
  });
});

describe('Region slice 1 — the partner is INERT (flag-on home == flag-off)', () => {
  it('a 30-day City run: home rngState / serialized-home / money identical to flag-off', () => {
    const DAYS = 30;
    const off = createInitialState(11, cityConfig());
    const offSim = new Simulation(off);
    offSim.dispatch({ type: 'RESUME' });
    offSim.run(ticksPerDay(off.config) * DAYS);

    const on = createInitialState(11, regionConfig());
    expect(on.towns[PARTNER_TOWN_ID]).toBeTruthy(); // partner materialized
    const partnerBefore = JSON.stringify(on.towns[PARTNER_TOWN_ID]);
    const onSim = new Simulation(on);
    onSim.dispatch({ type: 'RESUME' });
    onSim.run(ticksPerDay(on.config) * DAYS);

    // Isolation: home is byte-identical with the partner present (no read-leak).
    expect(on.rngState).toBe(off.rngState);
    expect(JSON.stringify(on.towns[HOME_TOWN_ID])).toBe(JSON.stringify(off.towns[HOME_TOWN_ID]));
    // The flat money primitive omits the partner, so flag-on == flag-off exactly.
    expect(totalMoneySupply(on)).toBe(totalMoneySupply(off));
    // The partner is untouched by the home-only tick loop (no write-leak).
    expect(JSON.stringify(on.towns[PARTNER_TOWN_ID])).toBe(partnerBefore);
  });

  it('two flag-on City runs agree bit-for-bit (determinism, partner + home)', () => {
    const DAYS = 30;
    const a = createInitialState(11, regionConfig());
    const b = createInitialState(11, regionConfig());
    const sa = new Simulation(a);
    const sb = new Simulation(b);
    sa.dispatch({ type: 'RESUME' });
    sb.dispatch({ type: 'RESUME' });
    sa.run(ticksPerDay(a.config) * DAYS);
    sb.run(ticksPerDay(b.config) * DAYS);
    expect(a.rngState).toBe(b.rngState);
    expect(normalizedSerialize(a)).toBe(normalizedSerialize(b));
  });
});

describe('Region slice 1 — the money debt is real (slice-2 oracle)', () => {
  it('the flat primitive omits exactly the partner town holder cash', () => {
    const s = createInitialState(11, regionConfig());
    const partner = s.towns[PARTNER_TOWN_ID]!;
    // The flat totalMoneySupply reads towns.home only, so it omits the partner.
    const flat = totalMoneySupply(s);
    let region = s.worldCash;
    for (const tid of Object.keys(s.towns)) region += townCash(s.towns[tid]!);
    expect(region - flat).toBe(townCash(partner));
    expect(townCash(partner)).toBeGreaterThan(0);
  });
});
