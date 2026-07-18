import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';

describe('UPDATE_SUPPLY_CONTRACT', () => {
  it('edits parameters, pauses, and resumes shipments', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const contractId = Object.keys(state.contracts)[0]!;
    const ctr = state.contracts[contractId]!;

    sim.dispatch({
      type: 'UPDATE_SUPPLY_CONTRACT',
      contractId,
      reorderPoint: 5,
      targetQuantity: 55,
      maxInventory: 99,
    });
    expect(ctr.reorderPoint).toBe(5);
    expect(ctr.targetQuantity).toBe(55);
    expect(ctr.maxInventory).toBe(99);

    // Invalid values are ignored.
    sim.dispatch({ type: 'UPDATE_SUPPLY_CONTRACT', contractId, targetQuantity: -3, reorderPoint: -1 });
    expect(ctr.targetQuantity).toBe(55);
    expect(ctr.reorderPoint).toBe(5);

    // Paused contracts ship nothing.
    sim.dispatch({ type: 'UPDATE_SUPPLY_CONTRACT', contractId, active: false });
    const dest = state.facilities[ctr.destinationFacilityId]!;
    const before = dest.dailyStats.unitsReceived;
    sim.run(ticksPerDay(state.config) - 2); // within a day (no daily reset)
    const vehiclesForContract = Object.values(state.vehicles).filter((v) => v.contractId === contractId);
    expect(vehiclesForContract.length).toBe(0);
    expect(dest.dailyStats.unitsReceived).toBe(before);

    sim.dispatch({ type: 'UPDATE_SUPPLY_CONTRACT', contractId, active: true });
    expect(ctr.active).toBe(true);
  });
});
