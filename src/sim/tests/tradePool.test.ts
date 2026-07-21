import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { newSim, normalizedSerialize } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { addStock } from '../entities/Inventory';
import { cityPrice, performExport } from '../core/Trade';
import { poolTargetInventory, poolCoverMult } from '../data/tradePool';
import { serialize, deserialize } from '../persistence/saveLoad';

/** A City sim with the demand pools opted in (the UI's City-world default). */
function poolSim(seed = 11): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', tradeDemandPoolsEnabled: true }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

/** A player warehouse loaded with `units` of `pid`, returned for exporting. */
function loadedWarehouse(sim: Simulation, pid: string, units: number) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 500000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  addStock(wh.inputInventory, pid, units, 60);
  return wh;
}

describe('Trade-city demand pools — pinned-baseline gate', () => {
  it('does not materialize with the flag off (Village or plain City)', () => {
    const village = newSim(11).getState();
    expect(village.tradeCities['port_rosa']!.pool).toBeUndefined();

    const plainCity = createInitialState(4, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    expect(plainCity.tradeCities['port_rosa']!.pool).toBeUndefined();
    expect(plainCity.tradeCities['ironvale']!.pool).toBeUndefined();
  });

  it('serializes NO pool key with the flag off (byte-identity guard)', () => {
    const sim = newSim(1);
    sim.run(ticksPerDay(sim.getState().config) * 30);
    // The whole serialized state must not mention the pool — the trade book is
    // exactly the pre-Arc-E book, so the bit-identity hash is untouched but for
    // the one new (false) config flag.
    expect(normalizedSerialize(sim.getState())).not.toContain('"pool"');
  });

  it('leaves the flag-off export path on the classic one-tick impact', () => {
    // With no pool, an export still moves the quote via applyPriceImpact (the
    // book price itself changes) — proving the pool did not silently take over.
    const sim = newSim(1);
    const state = sim.getState();
    state.firms[state.playerFirmId]!.cash = 50000_00;
    const wh = loadedWarehouse(sim, 'bread', 200);
    const book0 = state.tradeCities['port_rosa']!.pricesByProduct['bread']!;
    performExport(state, state.playerFirmId, wh.id, 'bread', 150, 'test', 'port_rosa');
    expect(state.tradeCities['port_rosa']!.pool).toBeUndefined();
    expect(state.tradeCities['port_rosa']!.pricesByProduct['bread']).toBeLessThan(book0);
  });

  it('a raw export on a POOL city still takes the classic one-tick impact', () => {
    // The pool only stocks consumer (needSpec) products — a raw like grain has
    // no larder entry. The pool-vs-impact branch must test the PRODUCT, not the
    // city: a city-level guard silently exempted raw exports from ALL impact,
    // reopening the riskless cross-city round-trip applyPriceImpact exists to
    // prevent (review blocker). This fails on the reverted city-level guard.
    const sim = poolSim(11);
    const state = sim.getState();
    const wh = loadedWarehouse(sim, 'grain', 200);
    expect(state.tradeCities['port_rosa']!.pool).toBeTruthy();
    expect(state.tradeCities['port_rosa']!.pool!.inventory['grain']).toBeUndefined();
    const book0 = cityPrice(state, 'port_rosa', 'grain');
    performExport(state, state.playerFirmId, wh.id, 'grain', 150, 'test', 'port_rosa');
    expect(cityPrice(state, 'port_rosa', 'grain')).toBeLessThan(book0);
  });
});

describe('Trade-city demand pools — behavior (flag on)', () => {
  it('seeds each city at its target buffer, so a fresh game quotes the bare walk', () => {
    const state = poolSim().getState();
    for (const cid of ['port_rosa', 'ironvale']) {
      const pool = state.tradeCities[cid]!.pool!;
      expect(pool.population).toBeGreaterThan(0);
      const target = poolTargetInventory(cid, 'bread');
      expect(pool.inventory['bread']).toBeCloseTo(target, 5);
      // At the target buffer the cover mult is exactly 1: cityPrice == walk.
      expect(poolCoverMult(cid, 'bread', pool.inventory['bread']!)).toBe(1);
      expect(cityPrice(state, cid, 'bread')).toBe(state.tradeCities[cid]!.pricesByProduct['bread']);
    }
    // A raw the city doesn't consume carries no pool inventory and no effect.
    expect(state.tradeCities['port_rosa']!.pool!.inventory['grain']).toBeUndefined();
    expect(cityPrice(state, 'port_rosa', 'grain')).toBe(
      state.tradeCities['port_rosa']!.pricesByProduct['grain'],
    );
  });

  it('a big export overhangs the quote below the walk for DAYS, not one tick', () => {
    const sim = poolSim();
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const wh = loadedWarehouse(sim, 'bread', 600);
    performExport(state, state.playerFirmId, wh.id, 'bread', 500, 'dump', 'port_rosa');

    const target = poolTargetInventory('port_rosa', 'bread');
    // Right after the dump the larder is well over target and the quote sits
    // below the raw walk (a discount), and stays there while stock works off.
    let depressedDays = 0;
    for (let d = 0; d < 8; d++) {
      const book = state.tradeCities['port_rosa']!.pricesByProduct['bread']!;
      const quote = cityPrice(state, 'port_rosa', 'bread');
      const inv = state.tradeCities['port_rosa']!.pool!.inventory['bread']!;
      if (inv > target && quote < book) depressedDays++;
      sim.run(tpd);
    }
    // The one-tick era would have healed within a day or two; the overhang holds.
    expect(depressedDays).toBeGreaterThanOrEqual(5);
    // And the larder is draining back toward target (not stuck).
    expect(state.tradeCities['port_rosa']!.pool!.inventory['bread']!).toBeLessThan(target + 500);
    expect(state.tradeCities['port_rosa']!.pool!.inventory['bread']!).toBeGreaterThan(target);
  });

  it('a starving city pays a premium over its walk', () => {
    const state = poolSim().getState();
    const target = poolTargetInventory('port_rosa', 'bread');
    // Drain the larder to ~1 day of cover: a genuine shortage.
    state.tradeCities['port_rosa']!.pool!.inventory['bread'] = target / 6;
    const book = state.tradeCities['port_rosa']!.pricesByProduct['bread']!;
    expect(cityPrice(state, 'port_rosa', 'bread')).toBeGreaterThan(book);
    // Bounded by the clamp — never runs away past the walk's band.
    expect(poolCoverMult('port_rosa', 'bread', target / 6)).toBeLessThanOrEqual(1.55);
  });

  it('conserves money across a pooled export, and the pool takes units not cash', () => {
    const sim = poolSim();
    const state = sim.getState();
    const wh = loadedWarehouse(sim, 'bread', 500);
    const inv0 = state.tradeCities['port_rosa']!.pool!.inventory['bread']!;
    const supplyBefore = totalMoneySupply(state);
    performExport(state, state.playerFirmId, wh.id, 'bread', 400, 'dump', 'port_rosa');
    // The export settles world→firm through recordTransaction — total invariant.
    expect(totalMoneySupply(state)).toBe(supplyBefore);
    // The 400 units went into the city's larder, not a pool cash account.
    expect(state.tradeCities['port_rosa']!.pool!.inventory['bread']).toBe(inv0 + 400);
  });

  it('is deterministic — two pooled runs agree bit-for-bit through a dump', () => {
    const a = poolSim(7);
    const b = poolSim(7);
    const tpd = ticksPerDay(a.getState().config);
    for (const s of [a, b]) {
      const wh = loadedWarehouse(s, 'bread', 400);
      performExport(s.getState(), s.getState().playerFirmId, wh.id, 'bread', 300, 'd', 'port_rosa');
      s.run(tpd * 15);
    }
    expect(a.getState().tradeCities['port_rosa']!.pool!.inventory['bread'])
      .toBe(b.getState().tradeCities['port_rosa']!.pool!.inventory['bread']);
    expect(a.getState().rngState).toBe(b.getState().rngState);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
  });

  it('round-trips the pool through save/load', () => {
    const sim = poolSim(11);
    const state = sim.getState();
    const wh = loadedWarehouse(sim, 'bread', 300);
    performExport(state, state.playerFirmId, wh.id, 'bread', 200, 'd', 'port_rosa');
    const quoteBefore = cityPrice(state, 'port_rosa', 'bread');
    const reloaded = deserialize(serialize(state));
    // The pool survived the round trip and quotes the same cover-adjusted price.
    expect(reloaded.tradeCities['port_rosa']!.pool!.inventory['bread'])
      .toBe(state.tradeCities['port_rosa']!.pool!.inventory['bread']);
    expect(cityPrice(reloaded, 'port_rosa', 'bread')).toBe(quoteBefore);
  });
});
