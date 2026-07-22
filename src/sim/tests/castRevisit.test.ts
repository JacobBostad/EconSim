/**
 * Cast restocked-shelf revisit (cast-parity attempt #3) — dark-foundation guards.
 *
 * The mechanism is NO-SHIP (see docs/design/cohorts-and-districts.md, "cast-parity
 * attempt #3"): it lifts cast worker satisfaction but re-triggers the documented
 * immigration flood and collapses the seed-11 comfortable band, so it stays
 * flag-OFF everywhere. These tests lock the two properties a dark foundation must
 * hold: it is byte-INERT when off (and unreachable in a Village even if forced
 * on), and DETERMINISTIC + conserved when on. There is no pinned-band test — the
 * flag never ships on, so the committed tierAcceptance bands are the shipped
 * flag-off ones.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { newSim, normalizedSerialize } from './helpers';

const cityPreset = SIZE_PRESETS.city as { restockRevisit: boolean };
const villagePreset = SIZE_PRESETS.village as { restockRevisit: boolean };

afterEach(() => {
  // Never let a forced flag leak into another test in this file.
  cityPreset.restockRevisit = false;
  villagePreset.restockRevisit = false;
});

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

/** Run day-by-day and report whether any citizen ever carried a queued revisit. */
function runAndWatchQueue(sim: Simulation, days: number): boolean {
  const tpd = ticksPerDay(sim.getState().config);
  let sawQueue = false;
  for (let t = 0; t < tpd * days; t++) {
    sim.tick();
    for (const id in sim.getState().citizens) {
      const q = sim.getState().citizens[id]!.pendingRevisits;
      if (q && q.length > 0) { sawQueue = true; break; }
    }
    if (sawQueue) break;
  }
  return sawQueue;
}

describe('Cast restocked-shelf revisit (cast-parity #3 dark foundation)', () => {
  it('is dark with the flag off: no cast citizen ever queues a revisit', () => {
    const sim = citySim(11);
    const saw = runAndWatchQueue(sim, 40);
    expect(saw).toBe(false);
    // And money is conserved (baseline sanity).
    const state = sim.getState();
    const money0 = 3169000_00; // City starting supply
    expect(totalMoneySupply(state)).toBe(money0);
  });

  it('stays byte-identical in a Village even when the flag is FORCED on (crowd-gated)', () => {
    // The flag is preset-scoped to City in the probes, but the SYSTEM is double-
    // gated on crowd presence, so forcing it true in a Village (no cohort) is inert.
    const base = newSim(11);
    base.run(ticksPerDay(base.getState().config) * 30);

    villagePreset.restockRevisit = true;
    const forced = newSim(11);
    forced.run(ticksPerDay(forced.getState().config) * 30);

    expect(forced.getState().rngState).toBe(base.getState().rngState);
    expect(totalMoneySupply(forced.getState())).toBe(totalMoneySupply(base.getState()));
    expect(normalizedSerialize(forced.getState())).toBe(normalizedSerialize(base.getState()));
    // No Village citizen carries the field.
    for (const id in forced.getState().citizens) {
      expect(forced.getState().citizens[id]!.pendingRevisits).toBeUndefined();
    }
  });

  it('engages with the flag on: cast workers queue and consume revisits', () => {
    cityPreset.restockRevisit = true;
    const sim = citySim(11);
    const saw = runAndWatchQueue(sim, 60);
    expect(saw).toBe(true);
  });

  it('is deterministic and conserved with the flag on', () => {
    cityPreset.restockRevisit = true;
    const a = citySim(4);
    const b = citySim(4);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 60);
    b.run(tpd * 60);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    // Conserved to the cent (revisit purchases move money only via recordTransaction).
    expect(totalMoneySupply(a.getState())).toBe(3169000_00);
  });

  it('changes the outcome vs flag-off (the mechanism is not a no-op when on)', () => {
    const off = citySim(11);
    off.run(ticksPerDay(off.getState().config) * 60);

    cityPreset.restockRevisit = true;
    const on = citySim(11);
    on.run(ticksPerDay(on.getState().config) * 60);

    // Flag-on diverges: the extra cast purchases ripple into the shared state.
    expect(normalizedSerialize(on.getState())).not.toBe(normalizedSerialize(off.getState()));
  });
});
