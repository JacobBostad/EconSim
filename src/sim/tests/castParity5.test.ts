/**
 * Cast-parity attempt #5 — dark-foundation guard for the still-live preset knob
 * `restockRevisitSyntheticSignal` (the founder-signal-neutral split for the
 * revisit). NO-SHIP (see docs/design/cohorts-and-districts.md, "cast-parity
 * attempt #5"): it stays at its inert default everywhere
 * (`restockRevisitSyntheticSignal: false`). These tests lock the properties a
 * dark foundation must hold: byte-INERT at the shipped default, unreachable in a
 * Village even if forced, and DETERMINISTIC + conserved when engaged. There is no
 * pinned-band test — the flag never ships on, so the committed tierAcceptance
 * bands remain the shipped ones.
 *
 * (The sibling `crowdWageBufferDays` guards were pruned with the knob at
 * 2e8fb1b — measured dead, byte-identical CWBD 1-20 at the shipped wage; see
 * docs/design/cohorts-and-districts.md verdict #5.)
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
};
const villagePreset = SIZE_PRESETS.village as {
  restockRevisit: boolean;
  restockRevisitSyntheticSignal: boolean;
};

afterEach(() => {
  // Never let a forced knob leak into another test.
  cityPreset.restockRevisit = false;
  cityPreset.restockRevisitSyntheticSignal = false;
  villagePreset.restockRevisit = false;
  villagePreset.restockRevisitSyntheticSignal = false;
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
