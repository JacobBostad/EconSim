import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { buildStarterChain } from '../core/ChainBuilder';
import { CHAIN_BLUEPRINTS, chainCost, stageOutput } from '../data/chains';
import { getFacilityDef } from '../data/facilityDefinitions';
import { getRecipe } from '../data/recipes';

/**
 * Arc C3 — chain blueprints as N production stages.
 *
 * These pin the mechanical conversion contract: a 2-stage blueprint (the whole
 * pre-C3 catalog) builds the SAME producer→factory→store output the fixed
 * triple used to — same facilities, same order, same coordinates, same
 * contracts (the Village wizard/founder paths are bit-identity pinned, verified
 * whole-game by village-bitidentity-check). And the deep chains (appliances,
 * furniture) build a genuine 3-stage path through an intermediate.
 */

/** A metropolis sim with the player firm handed enough cash to build anything. */
function metroSim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' }),
  );
  sim.dispatch({ type: 'RESUME' });
  const s = sim.getState();
  recordTransaction(s, {
    from: WORLD_ACCOUNT, to: firmAccount(s.playerFirmId), amount: 500_000,
    firmId: s.playerFirmId, category: 'none', note: 'test capital',
  });
  return sim;
}

describe('C3 chain blueprints — mechanical shape', () => {
  it('every classic/C1 chain is 2-stage (raw producer → factory), the deep chains are 3-stage', () => {
    for (const [pid, bp] of Object.entries(CHAIN_BLUEPRINTS)) {
      // Stage 0 always extracts a raw (no recipe inputs); the last stage makes
      // the retailed product; each middle link consumes the prior output.
      expect(getRecipe(bp.stages[0]!.recipeId).inputs.length, pid).toBe(0);
      expect(bp.stages[bp.stages.length - 1]!.recipeId, pid).toBeTruthy();
      expect(stageOutput(bp.stages[bp.stages.length - 1]!), pid).toBe(pid);
      for (let i = 1; i < bp.stages.length; i++) {
        const prevOut = stageOutput(bp.stages[i - 1]!);
        expect(getRecipe(bp.stages[i]!.recipeId).inputs.some((inp) => inp.productId === prevOut), `${pid} link ${i}`).toBe(true);
      }
    }
    expect(CHAIN_BLUEPRINTS.bread!.stages.length).toBe(2);
    expect(CHAIN_BLUEPRINTS.tools!.stages.length).toBe(2);
    expect(CHAIN_BLUEPRINTS.appliances!.stages.length).toBe(3);
    expect(CHAIN_BLUEPRINTS.furniture!.stages.length).toBe(3);
  });

  it('chainCost sums every stage facility + the store', () => {
    const bp = CHAIN_BLUEPRINTS.appliances!;
    const expected =
      getFacilityDef('mine').buildCost +
      getFacilityDef('factory').buildCost + // smelt_steel
      getFacilityDef('factory').buildCost + // forge_appliances
      getFacilityDef('retail').buildCost;
    expect(chainCost(bp)).toBe(expected);
  });
});

describe('C3 chain builder — 2-stage byte-identical output', () => {
  it('a 2-stage bread chain builds exactly producer → factory → store, wired the classic way', () => {
    // Village keeps the pinned fixed build rows (20/33/51). Build into a fresh
    // Village state and pin the concrete structure the pre-C3 triple produced.
    const sim = new Simulation(createInitialState(3));
    sim.dispatch({ type: 'RESUME' });
    const s = sim.getState();
    const firmId = s.playerFirmId;
    const before = new Set(Object.keys(s.facilities));

    const built = buildStarterChain(s, firmId, 'bread');
    expect(built).toBeTruthy();
    const b = built!;

    // Exactly THREE new facilities: producer, factory, store — in that order.
    const created = Object.keys(s.facilities).filter((id) => !before.has(id));
    expect(created.length).toBe(3);
    expect(b.stages.length).toBe(2);
    expect(b.producer).toBe(b.stages[0]);
    expect(b.factory).toBe(b.stages[1]);

    expect(b.producer.type).toBe('farm');
    expect(b.producer.activeRecipeId).toBe('grow_grain');
    expect(b.factory.type).toBe('factory');
    expect(b.factory.activeRecipeId).toBe('bake_bread');
    expect(b.store.type).toBe('retail');
    expect(b.store.retailProductIds).toEqual(['bread']);

    // Pinned Village build rows (the bit-identity coordinates).
    expect(b.producer.location.y).toBe(20);
    expect(b.factory.location.y).toBe(33);
    expect(b.store.location.y).toBe(51);

    // Two supply contracts: producer→factory (grain), factory→store (bread),
    // with the pinned sizing (40 / 16 / 80).
    const contracts = Object.values(s.contracts).filter((c) => c.ownerFirmId === firmId);
    expect(contracts.length).toBe(2);
    const upstream = contracts.find((c) => c.sourceFacilityId === b.producer.id)!;
    const downstream = contracts.find((c) => c.sourceFacilityId === b.factory.id)!;
    expect(upstream.destinationFacilityId).toBe(b.factory.id);
    expect(upstream.productId).toBe('grain');
    expect(downstream.destinationFacilityId).toBe(b.store.id);
    expect(downstream.productId).toBe('bread');
    for (const c of contracts) {
      expect(c.targetQuantity).toBe(40);
      expect(c.reorderPoint).toBe(16);
      expect(c.maxInventory).toBe(80);
    }
  });
});

describe('C3 chain builder — 3-stage deep chain', () => {
  it('the appliances chain builds mine → steel factory → appliance factory → store, wired through steel', () => {
    const sim = metroSim(5);
    const s = sim.getState();
    const firmId = s.playerFirmId;
    const before = new Set(Object.keys(s.facilities));

    const built = buildStarterChain(s, firmId, 'appliances');
    expect(built).toBeTruthy();
    const b = built!;

    // FOUR new facilities: mine, steel factory, appliance factory, store.
    const created = Object.keys(s.facilities).filter((id) => !before.has(id));
    expect(created.length).toBe(4);
    expect(b.stages.length).toBe(3);

    expect(b.stages[0]!.type).toBe('mine');
    expect(b.stages[0]!.activeRecipeId).toBe('mine_minerals');
    expect(b.stages[1]!.type).toBe('factory');
    expect(b.stages[1]!.activeRecipeId).toBe('smelt_steel');
    expect(b.stages[2]!.type).toBe('factory');
    expect(b.stages[2]!.activeRecipeId).toBe('forge_appliances');
    expect(b.store.retailProductIds).toEqual(['appliances']);
    // Back-compat aliases point at the ends of the chain.
    expect(b.producer).toBe(b.stages[0]);
    expect(b.factory).toBe(b.stages[2]);

    // THREE supply contracts: minerals → steel → appliances, each stage to the
    // next, then the finishing factory to the store.
    const contracts = Object.values(s.contracts).filter((c) => c.ownerFirmId === firmId);
    expect(contracts.length).toBe(3);
    const byProduct = Object.fromEntries(contracts.map((c) => [c.productId, c]));
    expect(byProduct.minerals!.sourceFacilityId).toBe(b.stages[0]!.id);
    expect(byProduct.minerals!.destinationFacilityId).toBe(b.stages[1]!.id);
    expect(byProduct.steel!.sourceFacilityId).toBe(b.stages[1]!.id);
    expect(byProduct.steel!.destinationFacilityId).toBe(b.stages[2]!.id);
    expect(byProduct.appliances!.sourceFacilityId).toBe(b.stages[2]!.id);
    expect(byProduct.appliances!.destinationFacilityId).toBe(b.store.id);
  });
});
