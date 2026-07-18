import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { addStock } from '../entities/Inventory';
import { wholesaleBoard } from '../selectors/wholesaleSelectors';
import { getProduct } from '../data/products';
import { IMPORT_MARKUP } from '../data/constants';

describe('Wholesale board selector', () => {
  it('lists sellers cheapest-first with surplus, price, and the importer benchmark', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 100, y: 20 } });
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 108, y: 20 } });
    const [farmA, farmB] = player.facilities.map((i) => state.facilities[i]!);
    addStock(farmA!.outputInventory, 'grain', 100, 60);
    addStock(farmB!.outputInventory, 'grain', 100, 60);
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farmA!.id, mult: 0.9 });
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farmB!.id, mult: 0.6 });

    const board = wholesaleBoard(state);
    const grain = board.find((p) => p.productId === 'grain')!;
    expect(grain).toBeTruthy();
    expect(grain.importerUnit).toBe(Math.round(getProduct('grain').basePrice * IMPORT_MARKUP));

    const ours = grain.rows.filter((r) => r.isPlayer);
    expect(ours.length).toBe(2);
    // Cheapest first.
    expect(ours[0]!.facilityId).toBe(farmB!.id);
    expect(ours[0]!.mult).toBe(0.6);
    expect(ours[0]!.surplus).toBe(100);
    expect(ours[0]!.unitPrice).toBeLessThan(ours[1]!.unitPrice);
  });

  it('hides opted-out facilities and empty sellers', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 100, y: 20 } });
    const farm = state.facilities[player.facilities[0]!]!;

    // Empty farm: not on the board.
    expect(wholesaleBoard(state).some((p) => p.rows.some((r) => r.facilityId === farm.id))).toBe(false);

    addStock(farm.outputInventory, 'grain', 100, 60);
    expect(wholesaleBoard(state).some((p) => p.rows.some((r) => r.facilityId === farm.id))).toBe(true);

    sim.dispatch({ type: 'TOGGLE_WHOLESALE', facilityId: farm.id, enabled: false });
    expect(wholesaleBoard(state).some((p) => p.rows.some((r) => r.facilityId === farm.id))).toBe(false);
  });
});
