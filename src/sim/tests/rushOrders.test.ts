import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import type { RushOrder } from '../core/GameState';
import { addStock } from '../entities/Inventory';
import { deserialize, serialize } from '../persistence/saveLoad';
import { RUSH_EARLIEST_DAY } from '../systems/RushOrderSystem';

function setupWithWarehouse(seed = 1) {
  const sim = newSim(seed);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 100000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[0]!]!;
  return { sim, state, player, wh };
}

function activeOrder(state: ReturnType<typeof setupWithWarehouse>['state']): RushOrder {
  const order: RushOrder = {
    cityId: 'port_rosa',
    productId: 'bread',
    quantity: 30,
    filled: 0,
    startDay: computeTime(state.tick, state.config).day,
    deadlineDay: computeTime(state.tick, state.config).day + 6,
    bonusCents: 5000,
  };
  state.rushOrder = order;
  return order;
}

describe('Rush orders', () => {
  it('offers appear only once the player owns a warehouse, and never overlap', () => {
    const withWh = setupWithWarehouse(3);
    let sawOffer = false;
    for (let day = 0; day < 60; day++) {
      withWh.sim.run(ticksPerDay(withWh.state.config));
      if (withWh.state.rushOrder) {
        sawOffer = true;
        expect(computeTime(withWh.state.tick, withWh.state.config).day).toBeGreaterThanOrEqual(RUSH_EARLIEST_DAY);
      }
    }
    expect(sawOffer).toBe(true);

    // Same seed, no player warehouse: the offer never rolls. (AI firms may
    // build warehouses of their own — only the player's matter.)
    const without = newSim(3);
    for (const fid in without.getState().facilities) {
      const f = without.getState().facilities[fid]!;
      if (f.ownerFirmId === without.getState().playerFirmId && f.type === 'warehouse') {
        throw new Error('scenario unexpectedly starts the player with a warehouse');
      }
    }
    for (let day = 0; day < 20; day++) {
      without.run(ticksPerDay(without.getState().config));
      expect(without.getState().rushOrder).toBeNull();
    }
  });

  it('player exports fill the order (any port) and completion pays the locked bonus', () => {
    const { sim, state, player, wh } = setupWithWarehouse();
    const order = activeOrder(state);
    addStock(wh.inputInventory, 'bread', 50, 60);
    const supply0 = totalMoneySupply(state);
    const cash0 = player.cash;

    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 10, cityId: 'ironvale' });
    expect(state.rushOrder?.filled).toBe(10);

    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 25, cityId: 'port_rosa' });
    expect(state.rushOrder).toBeNull();
    expect(state.rushOrdersCompleted).toBe(1);
    // Cash rose by export revenue + exactly the locked bonus.
    const exportRevenue = player.exportRevenue;
    expect(player.cash).toBe(cash0 + exportRevenue + order.bonusCents);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('other products and AI exports do not count', () => {
    const { sim, state, player, wh } = setupWithWarehouse();
    activeOrder(state);
    addStock(wh.inputInventory, 'tools', 20, 60);
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'tools', quantity: 20 });
    expect(state.rushOrder?.filled).toBe(0);

    // An AI firm shipping the rush product leaves the order untouched.
    const ai = Object.values(state.firms).find((f) => f.ownerType === 'ai');
    if (ai) {
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: ai.id, defId: 'warehouse', location: { x: 108, y: 24 } });
      const aiWh = state.facilities[ai.facilities[ai.facilities.length - 1]!]!;
      if (aiWh.type === 'warehouse') {
        addStock(aiWh.inputInventory, 'bread', 40, 60);
        sim.dispatch({ type: 'EXPORT_GOODS', firmId: ai.id, facilityId: aiWh.id, productId: 'bread', quantity: 40 });
        expect(state.rushOrder?.filled).toBe(0);
      }
    }
  });

  it('an unfilled order lapses after its deadline and counts as missed', () => {
    const { sim, state } = setupWithWarehouse();
    const order = activeOrder(state);
    order.deadlineDay = computeTime(state.tick, state.config).day; // expires tomorrow
    sim.run(ticksPerDay(state.config) * 2);
    expect(state.rushOrder).toBeNull();
    expect(state.rushOrdersMissed).toBe(1);
    expect(state.events.some((e) => e.message.includes('rush order lapsed'))).toBe(true);
  });

  it('rush state survives save/load, and old saves get defaults', () => {
    const { sim, state } = setupWithWarehouse();
    const order = activeOrder(state);
    const loaded = deserialize(serialize(state));
    expect(loaded.rushOrder).toEqual(order);

    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.rushOrder;
    delete raw.rushOrdersCompleted;
    delete raw.rushOrdersMissed;
    const migrated = deserialize(JSON.stringify(raw));
    expect(migrated.rushOrder).toBeNull();
    expect(migrated.rushOrdersCompleted).toBe(0);
    expect(migrated.rushOrdersMissed).toBe(0);
    expect(sim.getState().rushOrdersMissed).toBe(0);
  });

  it('completing a rush order unlocks Beat the Clock', () => {
    const { sim, state, player, wh } = setupWithWarehouse();
    activeOrder(state);
    addStock(wh.inputInventory, 'bread', 40, 60);
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 35 });
    expect(state.rushOrdersCompleted).toBe(1);
    sim.run(ticksPerDay(state.config)); // let the hourly achievement scan run
    expect(state.achievements.some((a) => a.id === 'beat_the_clock')).toBe(true);
  });
});
