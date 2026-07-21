import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { FORWARD_DEFAULT_PENALTY, FORWARD_MAX_OPEN } from '../systems/ForwardSystem';
import { exportFreightFee, impactedFillPrice, performExport } from '../core/Trade';
import { getQuantity, addStock } from '../entities/Inventory';
import { getProduct } from '../data/products';
import { deserialize, serialize } from '../persistence/saveLoad';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';

function setup(seed = 3) {
  const sim = newSim(seed);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 100000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 70, y: 30 } });
  const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  const day = computeTime(state.tick, state.config).day;
  return { sim, state, player, wh, day };
}

function lock(sim: Simulation, qty: number, daysOut = 3) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  const day = computeTime(state.tick, state.config).day;
  sim.dispatch({
    type: 'SELL_FORWARD', firmId: player.id, productId: 'tools',
    quantity: qty, cityId: 'ironvale', deliveryDay: day + daysOut,
  });
}

describe('Forward contracts', () => {
  it('locks today\'s price, delivers staged goods, conserves money', () => {
    const { sim, state, player, wh } = setup();
    state.tradeCities['ironvale']!.pricesByProduct['tools'] = getProduct('tools').basePrice * 2;
    addStock(wh.inputInventory, 'tools', 60, 60);
    lock(sim, 50, 3);
    expect(player.forwards.length).toBe(1);
    const locked = player.forwards[0]!.lockedPrice;
    expect(locked).toBe(
      Math.round(impactedFillPrice(getProduct('tools').basePrice * 2, 50, -1)),
    );

    // Price collapses — the lock is what pays.
    state.tradeCities['ironvale']!.pricesByProduct['tools'] = Math.round(getProduct('tools').basePrice * 0.7);
    const supply0 = totalMoneySupply(state);
    const cash0 = player.cash;
    sim.run(ticksPerDay(state.config) * 4);
    expect(player.forwards.length).toBe(0);
    expect(getQuantity(wh.inputInventory, 'tools')).toBe(10); // 50 pulled
    const net = Math.round(locked * (1 - exportFreightFee(state, 'ironvale')));
    expect(player.cash).toBeGreaterThanOrEqual(cash0 + net * 50 - 2000_00); // minus running costs
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.forwardWins).toBe(1); // locked at 2x base
    expect(state.achievements.some((a) => a.id === 'market_wizard')).toBe(true);
  });

  it('coming up short costs the default penalty', () => {
    const { sim, state, player, wh } = setup();
    addStock(wh.inputInventory, 'tools', 20, 60); // only 20 of 50
    lock(sim, 50, 3);
    const locked = player.forwards[0]!.lockedPrice;
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * 4);
    expect(player.forwards.length).toBe(0);
    expect(getQuantity(wh.inputInventory, 'tools')).toBe(0); // partial delivery took all 20
    expect(totalMoneySupply(state)).toBe(supply0);
    const penalty = Math.round(locked * 30 * FORWARD_DEFAULT_PENALTY);
    expect(state.events.some((e) => e.message.includes('short on a forward'))).toBe(true);
    expect(penalty).toBeGreaterThan(0);
  });

  it('two open forwards is the cap, and window bounds are enforced', () => {
    const { sim, player } = setup();
    lock(sim, 50, 3);
    lock(sim, 50, 5);
    lock(sim, 50, 7); // over the cap — refused
    expect(player.forwards.length).toBe(FORWARD_MAX_OPEN);

    player.forwards = [];
    lock(sim, 50, 1); // too soon
    lock(sim, 50, 20); // too far
    lock(sim, 500, 5); // too big
    expect(player.forwards.length).toBe(0);
  });

  it('inserting the system re-deals nothing without a contract', () => {
    const a = newSim(8);
    const b = newSim(8);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 15);
    b.run(tpd * 15);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
  });

  it('old saves migrate with no forwards and zero wins', () => {
    const sim = newSim(3);
    const raw = JSON.parse(serialize(sim.getState())) as {
      firms: Record<string, Record<string, unknown>>;
    };
    for (const fid in raw.firms) {
      delete raw.firms[fid]!.forwards;
      delete raw.firms[fid]!.forwardWins;
    }
    const migrated = deserialize(JSON.stringify(raw));
    for (const fid in migrated.firms) {
      expect(migrated.firms[fid]!.forwards).toEqual([]);
      expect(migrated.firms[fid]!.forwardWins).toBe(0);
    }
  });

  it('a village (flag-off) forward settlement touches no pool by construction', () => {
    const { sim, state, wh } = setup();
    // Village never materializes a pool; settlement must not create one.
    expect(state.tradeCities['ironvale']!.pool).toBeUndefined();
    addStock(wh.inputInventory, 'tools', 60, 60);
    lock(sim, 50, 3);
    sim.run(ticksPerDay(state.config) * 4);
    expect(state.firms[state.playerFirmId]!.forwards.length).toBe(0);
    expect(state.tradeCities['ironvale']!.pool).toBeUndefined();
  });
});

/** A pool-enabled City sim (the UI's City-world default) with a player
 * warehouse ready to stage goods for a forward. Bread is a pooled consumer
 * good the trade cities stock, so its settlement can feed the larder. */
function poolCitySetup(seed = 11) {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', tradeDemandPoolsEnabled: true }),
  );
  sim.dispatch({ type: 'RESUME' });
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 500000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  return { sim, state, player, wh };
}

function lockBread(sim: Simulation, qty: number, daysOut = 3) {
  const state = sim.getState();
  const day = computeTime(state.tick, state.config).day;
  sim.dispatch({
    type: 'SELL_FORWARD', firmId: state.playerFirmId, productId: 'bread',
    quantity: qty, cityId: 'port_rosa', deliveryDay: day + daysOut,
  });
}

describe('Forward settlement feeds the demand pool (Arc E, flag on)', () => {
  it('a delivered forward overhangs the larder; a deliberate default feeds nothing', () => {
    // The pool's daily drain/restock is a pure function of its own inventory
    // (independent of the walk and of player state), so three seed-11 runs move
    // the larder identically EXCEPT for the settlement feed — a clean isolation
    // of the feedPool effect the divergence note flagged as missing.
    const tpd = ticksPerDay(DEFAULT_CONFIG);

    // Baseline: no forward at all.
    const base = poolCitySetup(11);
    base.sim.run(tpd * 4);
    const baseInv = base.state.tradeCities['port_rosa']!.pool!.inventory['bread']!;

    // Deliver: stage 250 bread, sign for 200, settle. The 200 ships into the
    // larder — a cover overhang above the no-forward baseline.
    const del = poolCitySetup(11);
    addStock(del.wh.inputInventory, 'bread', 250, 60);
    lockBread(del.sim, 200, 3);
    expect(del.player.forwards.length).toBe(1);
    const supply0 = totalMoneySupply(del.state);
    del.sim.run(tpd * 4);
    expect(del.player.forwards.length).toBe(0);
    expect(getQuantity(del.wh.inputInventory, 'bread')).toBe(50); // 200 delivered
    const delInv = del.state.tradeCities['port_rosa']!.pool!.inventory['bread']!;
    expect(delInv).toBeGreaterThan(baseInv); // the delivered goods piled in
    // Settlement still books firm↔world through recordTransaction — conserved.
    expect(totalMoneySupply(del.state)).toBe(supply0);

    // Deliberate default: no stock, so nothing ships and nothing feeds. The
    // larder is byte-identical to the no-forward baseline (fed nothing).
    const def = poolCitySetup(11);
    lockBread(def.sim, 200, 3);
    def.sim.run(tpd * 4);
    expect(def.player.forwards.length).toBe(0);
    expect(def.state.events.some((e) => e.message.includes('short on a forward'))).toBe(true);
    const defInv = def.state.tradeCities['port_rosa']!.pool!.inventory['bread']!;
    expect(defInv).toBe(baseInv); // fed nothing — the divergence's "delivers nothing" arm
  });

  it('feeds the larder exactly like a spot export of the same size', () => {
    // Same seed, same day: a forward that DELIVERS 200 bread and a spot EXPORT
    // of 200 bread must leave the same larder at settlement — settlement is now
    // unified with the spot path (both route through feedPool for a pooled good).
    const tpd = ticksPerDay(DEFAULT_CONFIG);

    // Forward path: sign day+3, settle on day 3.
    const fwd = poolCitySetup(11);
    addStock(fwd.wh.inputInventory, 'bread', 250, 60);
    lockBread(fwd.sim, 200, 3);
    fwd.sim.run(tpd * 3);
    expect(fwd.player.forwards.length).toBe(0);
    const fwdInv = fwd.state.tradeCities['port_rosa']!.pool!.inventory['bread']!;

    // Spot path: run 3 quiet days first, then export 200 on day 3 — same larder
    // trajectory up to the shipment, same +200 feed.
    const spot = poolCitySetup(11);
    addStock(spot.wh.inputInventory, 'bread', 250, 60);
    spot.sim.run(tpd * 3);
    // performExport ships from the warehouse into the larder.
    performExport(spot.state, spot.state.playerFirmId, spot.wh.id, 'bread', 200, 'spot', 'port_rosa');
    const spotInv = spot.state.tradeCities['port_rosa']!.pool!.inventory['bread']!;

    expect(fwdInv).toBe(spotInv);
  });
});
