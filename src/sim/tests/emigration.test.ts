import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { Rng } from '../core/Random';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import type { GameState } from '../core/GameState';
import { totalMoneySupply } from '../core/GameState';
import { runImmigrationSystem, emigrationRoll } from '../systems/ImmigrationSystem';
import { EMIGRATION_GRACE_DAYS } from '../data/constants';
import { morningBriefing } from '../selectors/advisorSelectors';
import { serialize, deserialize } from '../persistence/saveLoad';

/** Drive the immigration/emigration system directly, one pinned "day" per
 * round: every citizen a miserable worker (or per override). The sim clock
 * advances tick boundaries only — no other systems run, so satisfaction
 * stays exactly where we pin it. */
function runMiserableDays(state: GameState, days: number, satisfaction = 30): void {
  const tpd = ticksPerDay(state.config);
  for (let i = 0; i < days; i++) {
    state.tick += tpd - (state.tick % tpd || tpd) + tpd; // next boundary
    for (const c of Object.values(state.citizens)) {
      c.tier = 'worker';
      c.satisfaction = satisfaction;
    }
    runImmigrationSystem({
      state, config: state.config, rng: new Rng(state),
      time: computeTime(state.tick, state.config),
    });
  }
}

describe('Emigration (the mutter made real)', () => {
  it('nobody leaves during the grace period; sustained misery bleeds after', () => {
    const state = newSim(7).getState();
    const pop0 = Object.keys(state.citizens).length;

    runMiserableDays(state, EMIGRATION_GRACE_DAYS);
    expect(Object.keys(state.citizens).length).toBe(pop0);
    expect(state.emigrationPressure).toBe(EMIGRATION_GRACE_DAYS);

    // Past the grace period the 25% daily gate fires within a couple weeks.
    runMiserableDays(state, 20);
    const pop1 = Object.keys(state.citizens).length;
    expect(pop1).toBeLessThan(pop0);
    expect(state.events.some((e) => e.message.includes('packed up and left town'))).toBe(true);
  });

  it('one good day resets the pressure — a rescued town stops bleeding', () => {
    const state = newSim(7).getState();
    runMiserableDays(state, EMIGRATION_GRACE_DAYS - 1);
    expect(state.emigrationPressure).toBe(EMIGRATION_GRACE_DAYS - 1);

    // Satisfaction recovers for a single day: pressure gone.
    runMiserableDays(state, 1, 60);
    expect(state.emigrationPressure).toBe(0);

    // Even a long stretch of contentment later never loses a citizen.
    const pop0 = Object.keys(state.citizens).length;
    runMiserableDays(state, 30, 60);
    expect(Object.keys(state.citizens).length).toBeGreaterThanOrEqual(pop0);
    expect(state.events.some((e) => e.message.includes('packed up and left town'))).toBe(false);
  });

  it('departures conserve money and clean up jobs and homes', () => {
    const sim = newSim(7);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config)); // let the town hire itself into shape
    const supply0 = totalMoneySupply(state);
    const before = new Set(Object.keys(state.citizens));

    runMiserableDays(state, EMIGRATION_GRACE_DAYS + 20);
    const goneIds = [...before].filter((id) => !state.citizens[id]);
    expect(goneIds.length).toBeGreaterThan(0);
    expect(state.emigrationDepartures).toBe(goneIds.length);
    expect(totalMoneySupply(state)).toBe(supply0);

    for (const id of goneIds) {
      for (const f of Object.values(state.facilities)) {
        expect(f.employees.includes(id)).toBe(false);
        expect(f.residentIds.includes(id)).toBe(false);
      }
      for (const firm of Object.values(state.firms)) {
        expect(firm.employees.includes(id)).toBe(false);
      }
    }
  });

  it('the departure gate is deterministic and pressure survives save/load', () => {
    // Same seed, same days → identical roll pattern.
    for (let d = 0; d < 50; d++) {
      expect(emigrationRoll(7, d)).toBe(emigrationRoll(7, d));
    }

    const state = newSim(7).getState();
    runMiserableDays(state, 5);
    expect(state.emigrationPressure).toBe(5);
    const loaded = deserialize(serialize(state));
    expect(loaded.emigrationPressure).toBe(5);

    // Old saves default the counter to zero.
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.emigrationPressure;
    expect(deserialize(JSON.stringify(raw)).emigrationPressure).toBe(0);
  });

  it('the advisor warns while pressure builds', () => {
    const state = newSim(7).getState();
    expect(morningBriefing(state).some((a) => a.icon === '🧳')).toBe(false);
    runMiserableDays(state, 4);
    const warn = morningBriefing(state).find((a) => a.icon === '🧳');
    expect(warn?.text).toContain('close to leaving');
  });

  it('healthy-but-modest Mill Country never bleeds', () => {
    const sim = new Simulation(createInitialState(11, undefined, 'mill_country'));
    sim.dispatch({ type: 'RESUME' });
    const state = sim.getState();
    const pop0 = Object.keys(state.citizens).length;
    sim.run(ticksPerDay(state.config) * 90);
    expect(Object.keys(state.citizens).length).toBeGreaterThanOrEqual(pop0);
    expect(state.events.some((e) => e.message.includes('packed up and left town'))).toBe(false);
  });
});
