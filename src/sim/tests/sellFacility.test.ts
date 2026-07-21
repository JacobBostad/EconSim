import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import { sellRefund } from '../core/Demolition';

describe('SELL_FACILITY', () => {
  function chainedPlayer(seed: number) {
    const sim = newSim(seed);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    return { sim, state, player };
  }

  it('refunds half the build cost, conserving money, and cleans every reference', () => {
    const { sim, state, player } = chainedPlayer(21);
    const farm = player.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'farm')!;
    const farmId = farm.id;
    const crew = [...farm.employees];
    expect(crew.length).toBeGreaterThan(0);
    const expected = sellRefund(state, player.id, farmId)!;
    expect(expected).toBe(Math.floor(farm.buildCost * 0.5));

    const cashBefore = player.cash;
    const supplyBefore = totalMoneySupply(state);
    sim.dispatch({ type: 'SELL_FACILITY', firmId: player.id, facilityId: farmId });

    expect(state.facilities[farmId]).toBeUndefined();
    expect(player.facilities).not.toContain(farmId);
    expect(player.cash).toBe(cashBefore + expected);
    expect(totalMoneySupply(state)).toBe(supplyBefore);
    // Crew released to the labor pool.
    for (const cid of crew) {
      const cit = state.citizens[cid]!;
      expect(cit.employmentStatus).toBe('unemployed');
      expect(cit.workplaceFacilityId).toBeNull();
    }
    expect(player.employees.some((cid) => crew.includes(cid))).toBe(false);
    // Contracts touching the farm are gone.
    expect(
      Object.values(state.contracts).some(
        (c) => c.sourceFacilityId === farmId || c.destinationFacilityId === farmId,
      ),
    ).toBe(false);
  });

  it('removes in-transit vehicles bound to or from the facility', () => {
    const { sim, state, player } = chainedPlayer(22);
    // Let logistics spin up some shipments.
    sim.dispatch({ type: 'RESUME' });
    sim.run(state.config.ticksPerHour * 24 * 3);
    const factory = player.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'factory')!;
    sim.dispatch({ type: 'SELL_FACILITY', firmId: player.id, facilityId: factory.id });
    expect(
      Object.values(state.vehicles).some(
        (v) => v.originFacilityId === factory.id || v.destinationFacilityId === factory.id,
      ),
    ).toBe(false);
  });

  it("cannot sell a rival's facility or the importer", () => {
    const { sim, state, player } = chainedPlayer(23);
    const rivalFac = findFacilityByName(state, 'Sunrise Bakery');
    const cashBefore = player.cash;
    sim.dispatch({ type: 'SELL_FACILITY', firmId: player.id, facilityId: rivalFac.id });
    expect(state.facilities[rivalFac.id]).toBeTruthy();
    expect(player.cash).toBe(cashBefore);

    // The importer is a world fixture, never a business asset.
    const importer = Object.values(state.facilities).find((f) => f.type === 'importer')!;
    expect(sellRefund(state, importer.ownerFirmId, importer.id)).toBeNull();
  });

  it('lets an apartment be sold like any facility (Phase 5)', () => {
    // Homes carry book value and sell now — building one is no longer a
    // permanent write-off. The world firm owns the town's homes; selling one
    // refunds half its (land-adjusted) build cost, conserved.
    const { state } = chainedPlayer(24);
    const home = Object.values(state.facilities).find((f) => f.type === 'home')!;
    const refund = sellRefund(state, home.ownerFirmId, home.id);
    expect(refund).not.toBeNull();
    expect(refund).toBe(Math.floor(home.buildCost * 0.5));
  });
});
