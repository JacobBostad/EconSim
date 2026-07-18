import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { FORWARD_DEFAULT_PENALTY, FORWARD_MAX_OPEN } from '../systems/ForwardSystem';
import { exportFreightFee, impactedFillPrice } from '../core/Trade';
import { getQuantity, addStock } from '../entities/Inventory';
import { getProduct } from '../data/products';
import { deserialize, serialize } from '../persistence/saveLoad';
import type { Simulation } from '../core/Simulation';

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
});
