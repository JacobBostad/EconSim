/**
 * Cast-parity attempt #5 — dark-foundation guards for the two new preset knobs:
 * `restockRevisitSyntheticSignal` (the founder-signal-neutral split for the
 * revisit) and `crowdWageBufferDays` (the crowd-hiring throttle, now preset-keyed
 * as the empShare lever). Both are NO-SHIP (see docs/design/cohorts-and-districts.md,
 * "cast-parity attempt #5"): they stay at their inert defaults everywhere
 * (`restockRevisitSyntheticSignal: false`, `crowdWageBufferDays: 7`). These tests
 * lock the properties a dark foundation must hold: byte-INERT at the shipped
 * defaults, unreachable in a Village even if forced, and DETERMINISTIC + conserved
 * when engaged. There is no pinned-band test — the flags never ship on, so the
 * committed tierAcceptance bands remain the shipped ones.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { newSim, normalizedSerialize } from './helpers';

const cityPreset = SIZE_PRESETS.city as {
  restockRevisit: boolean;
  restockRevisitSyntheticSignal: boolean;
  crowdWageBufferDays: number;
};
const villagePreset = SIZE_PRESETS.village as {
  restockRevisit: boolean;
  restockRevisitSyntheticSignal: boolean;
  crowdWageBufferDays: number;
};

afterEach(() => {
  // Never let a forced knob leak into another test.
  cityPreset.restockRevisit = false;
  cityPreset.restockRevisitSyntheticSignal = false;
  cityPreset.crowdWageBufferDays = 7;
  villagePreset.restockRevisit = false;
  villagePreset.restockRevisitSyntheticSignal = false;
  villagePreset.crowdWageBufferDays = 7;
});

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('restockRevisitSyntheticSignal (cast-parity #5 dark foundation)', () => {
  it('is byte-inert when forced true with the revisit OFF (only read on the revisit path)', () => {
    const base = citySim(11);
    base.run(ticksPerDay(base.getState().config) * 60);

    cityPreset.restockRevisitSyntheticSignal = true; // revisit stays false
    const forced = citySim(11);
    forced.run(ticksPerDay(forced.getState().config) * 60);

    expect(forced.getState().rngState).toBe(base.getState().rngState);
    expect(totalMoneySupply(forced.getState())).toBe(totalMoneySupply(base.getState()));
    expect(normalizedSerialize(forced.getState())).toBe(normalizedSerialize(base.getState()));
  });

  it('stays byte-identical in a Village even when both revisit knobs are FORCED on', () => {
    const base = newSim(11);
    base.run(ticksPerDay(base.getState().config) * 30);

    villagePreset.restockRevisit = true;
    villagePreset.restockRevisitSyntheticSignal = true;
    const forced = newSim(11);
    forced.run(ticksPerDay(forced.getState().config) * 30);

    expect(forced.getState().rngState).toBe(base.getState().rngState);
    expect(normalizedSerialize(forced.getState())).toBe(normalizedSerialize(base.getState()));
  });

  it('is deterministic and conserved with revisit + synthetic-signal on', () => {
    cityPreset.restockRevisit = true;
    cityPreset.restockRevisitSyntheticSignal = true;
    const a = citySim(4);
    const b = citySim(4);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 60);
    b.run(tpd * 60);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    // Conserved to the cent — the split touches only marketStats attribution, not money.
    expect(totalMoneySupply(a.getState())).toBe(3169000_00);
  });

  it('changes the founder-visible signal vs revisit-only (the split is not a no-op)', () => {
    // Same physical purchases, different marketStats attribution → divergent state.
    cityPreset.restockRevisit = true;
    const off = citySim(11);
    off.run(ticksPerDay(off.getState().config) * 90);

    cityPreset.restockRevisitSyntheticSignal = true;
    const on = citySim(11);
    on.run(ticksPerDay(on.getState().config) * 90);

    expect(normalizedSerialize(on.getState())).not.toBe(normalizedSerialize(off.getState()));
  });
});

describe('crowdWageBufferDays (cast-parity #5 dark foundation)', () => {
  it('is byte-identical to baseline at its shipped default (7)', () => {
    const base = citySim(11);
    base.run(ticksPerDay(base.getState().config) * 60);

    cityPreset.crowdWageBufferDays = 7; // explicit re-assert of the default
    const same = citySim(11);
    same.run(ticksPerDay(same.getState().config) * 60);

    expect(same.getState().rngState).toBe(base.getState().rngState);
    expect(normalizedSerialize(same.getState())).toBe(normalizedSerialize(base.getState()));
  });

  it('stays byte-identical in a Village even when relaxed (no crowd reaches the code)', () => {
    const base = newSim(11);
    base.run(ticksPerDay(base.getState().config) * 30);

    villagePreset.crowdWageBufferDays = 3;
    const forced = newSim(11);
    forced.run(ticksPerDay(forced.getState().config) * 30);

    expect(forced.getState().rngState).toBe(base.getState().rngState);
    expect(normalizedSerialize(forced.getState())).toBe(normalizedSerialize(base.getState()));
  });

  it('is wired live on the crowd: a much stricter buffer changes the City outcome', () => {
    // Note (attempt #5 finding): at the shipped $16 founder wage the buffer is
    // SLACK — firms are cash-rich enough that it never binds in the swept 5-10
    // range (CWBD 1..20 are byte-identical at seed 11), so the downward relaxation
    // is inert there. It only bites at an extreme buffer; CWBD 40 is used here
    // purely to prove the knob is wired live, not as a grid value.
    const base = citySim(11);
    base.run(ticksPerDay(base.getState().config) * 90);

    cityPreset.crowdWageBufferDays = 40;
    const strict = citySim(11);
    strict.run(ticksPerDay(strict.getState().config) * 90);

    expect(normalizedSerialize(strict.getState())).not.toBe(normalizedSerialize(base.getState()));
  });

  it('is deterministic and conserved at a relaxed buffer', () => {
    cityPreset.crowdWageBufferDays = 5;
    const a = citySim(7);
    const b = citySim(7);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 60);
    b.run(tpd * 60);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    expect(totalMoneySupply(a.getState())).toBe(3169000_00);
  });
});
