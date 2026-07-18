import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { addStock, getQuantity } from '../entities/Inventory';

/**
 * AI firms shop their input contracts: when a local firm (the player
 * included) holds a sustained surplus of an imported input and wholesale
 * beats the importer's premium, the AI repoints its contract — so a
 * pure-supplier player strategy gets real AI customers. If the local source
 * runs dry and the AI's destination starves, it reverts to the importer.
 */
describe('AI local sourcing', () => {
  function setup() {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    // Player farm with a big grain surplus.
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 100, y: 20 } });
    const farm = state.facilities[player.facilities[0]!]!;
    addStock(farm.outputInventory, 'grain', 200, 60);
    // Give an AI factory an importer-sourced grain contract (the shape AI
    // coffee roasteries use; starting chains are self-sufficient).
    const importer = Object.values(state.facilities).find((f) => f.type === 'importer')!;
    const aiFactory = Object.values(state.facilities).find(
      (f) => f.type === 'factory' && state.firms[f.ownerFirmId]?.ownerType === 'ai',
    )!;
    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: aiFactory.ownerFirmId,
      sourceFacilityId: importer.id, destinationFacilityId: aiFactory.id,
      productId: 'grain', targetQuantity: 20, reorderPoint: 10, maxInventory: 40,
    });
    const aiImportContract = Object.values(state.contracts).find(
      (c) => c.ownerFirmId === aiFactory.ownerFirmId && c.productId === 'grain'
        && state.facilities[c.sourceFacilityId]?.type === 'importer',
    );
    return { sim, state, player, farm, aiImportContract };
  }

  it('an AI grain importer switches to the player farm and pays wholesale', () => {
    const { sim, state, player, farm, aiImportContract } = setup();
    expect(aiImportContract).toBeTruthy();
    const supply0 = totalMoneySupply(state);
    const revenue0 = player.accounting.lifetime.revenue;

    sim.run(ticksPerDay(state.config) * 3);

    expect(state.facilities[aiImportContract!.sourceFacilityId]?.id).toBe(farm.id);
    // The AI actually bought grain from the player.
    expect(player.accounting.lifetime.revenue).toBeGreaterThan(revenue0);
    const buyer = state.firms[aiImportContract!.ownerFirmId]!;
    expect(buyer.wholesaleSpend).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('never sources from a facility whose owner opted out of wholesale', () => {
    const { sim, state, farm, aiImportContract } = setup();
    sim.dispatch({ type: 'TOGGLE_WHOLESALE', facilityId: farm.id, enabled: false });
    sim.run(ticksPerDay(state.config) * 3);
    expect(state.facilities[aiImportContract!.sourceFacilityId]?.type).toBe('importer');
  });

  it('disabling wholesale stops shipments and the AI reverts once its stock runs out', () => {
    const { sim, state, farm, aiImportContract } = setup();
    sim.run(ticksPerDay(state.config) * 2);
    expect(state.facilities[aiImportContract!.sourceFacilityId]?.id).toBe(farm.id);

    sim.dispatch({ type: 'TOGGLE_WHOLESALE', facilityId: farm.id, enabled: false });
    const dest = state.facilities[aiImportContract!.destinationFacilityId]!;
    dest.inputInventory = {}; // burn through the runway immediately
    sim.run(ticksPerDay(state.config) * 2);

    expect(state.facilities[aiImportContract!.sourceFacilityId]?.type).toBe('importer');
    // The farm kept its stock — no shipments left after the opt-out + revert.
    expect(getQuantity(farm.outputInventory, 'grain')).toBeGreaterThan(0);
  });

  it('reverts to the importer when the local source runs dry and the chain starves', () => {
    const { sim, state, farm, aiImportContract } = setup();
    sim.run(ticksPerDay(state.config) * 2);
    expect(state.facilities[aiImportContract!.sourceFacilityId]?.id).toBe(farm.id);

    // Starve the chain: dry farm, empty destination, and no other inbound
    // grain lines masking the problem (the bakery's own farm normally feeds it).
    const dest = state.facilities[aiImportContract!.destinationFacilityId]!;
    for (const cid in state.contracts) {
      const c = state.contracts[cid]!;
      if (c.id !== aiImportContract!.id && c.destinationFacilityId === dest.id && c.productId === 'grain') {
        c.active = false;
      }
    }
    farm.outputInventory = {};
    dest.inputInventory = {};
    sim.run(ticksPerDay(state.config) * 2);

    expect(state.facilities[aiImportContract!.sourceFacilityId]?.type).toBe('importer');
    // And the chain is being fed again.
    sim.run(ticksPerDay(state.config));
    expect(getQuantity(dest.inputInventory, 'grain')).toBeGreaterThan(0);
  });
});
