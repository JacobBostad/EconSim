import { describe, it, expect } from 'vitest';
import fixtureJson from './fixtures/golden-save-v1.json';
import { Simulation } from '../core/Simulation';
import { deserialize, serialize } from '../persistence/saveLoad';
import { totalMoneySupply } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';

/**
 * Golden-save compatibility guard: a REAL save produced by an earlier build
 * (day 40, seed 777 — chains, multi-product store, export orders, shares,
 * festival, upgrade, achievements, missions, trade prices, world events all
 * populated). Every future change must keep this artifact loadable and
 * runnable. If a migration is needed, add it to migrations.ts — do NOT
 * regenerate this fixture to paper over a break.
 */
describe('Golden save fixture', () => {
  const raw = JSON.stringify(fixtureJson);

  it('loads through the migration chain intact', () => {
    const state = deserialize(raw);
    expect(state.playerFirmId).toBeTruthy();
    const player = state.firms[state.playerFirmId]!;
    expect(player.facilities.length).toBeGreaterThanOrEqual(4);
    const store = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'retail')!;
    expect(store.retailProductIds.length).toBeGreaterThanOrEqual(2);
    const wh = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'warehouse')!;
    expect(wh.exportOrders['grain']).toBeTruthy();
    expect(Object.keys(player.sharesHeld).length).toBe(1);
    expect(state.achievements.length).toBeGreaterThan(0);
    expect(state.missions.length).toBeGreaterThan(0);
    expect(Object.keys(state.tradeCity.pricesByProduct).length).toBeGreaterThanOrEqual(8);
    // Round-trip stability: loading a re-serialized load changes nothing.
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the loaded world keeps running with money conserved', () => {
    const state = deserialize(raw);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    sim.run(ticksPerDay(state.config) * 5 + 1);
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    expect(Object.keys(sim.getState().citizens).length).toBeGreaterThan(0);
  });
});
