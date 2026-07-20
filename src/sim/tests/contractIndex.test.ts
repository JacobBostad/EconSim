import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import {
  buildContractIndex,
  indexAddContract,
  contractsBySource,
  contractsByDest,
  contractsByOwner,
} from '../core/ContractIndex';
import type { GameState } from '../core/GameState';
import type { Contract } from '../entities/Contract';

/**
 * The contract index stands in for the `for (const cid in state.contracts)`
 * scans in the AI-strategy / logistics paths. Its whole correctness claim is:
 * a bucket lists exactly the contract ids a filtered `for..in` would visit, in
 * the same order — so an index-driven scan is byte-identical to the scan it
 * replaces. These tests pin that against a LIVE city state (founders, chain
 * expansions and rival consolidations have churned the contract set by day
 * 150), plus the two invariants the mutation sites lean on: a freshly built
 * index matches a full scan, and an appended contract lands where a rebuild
 * would put it.
 */

/** The ordered ids a raw scan over state.contracts visits for a key predicate —
 * exactly the loop bodies the index replaced, minus the summed/counted work. */
function scanBySource(state: GameState, facId: string): string[] {
  const out: string[] = [];
  for (const cid in state.contracts) {
    if (state.contracts[cid]!.sourceFacilityId === facId) out.push(cid);
  }
  return out;
}
function scanByDest(state: GameState, facId: string): string[] {
  const out: string[] = [];
  for (const cid in state.contracts) {
    if (state.contracts[cid]!.destinationFacilityId === facId) out.push(cid);
  }
  return out;
}
function scanByOwner(state: GameState, firmId: string): string[] {
  const out: string[] = [];
  for (const cid in state.contracts) {
    if (state.contracts[cid]!.ownerFirmId === firmId) out.push(cid);
  }
  return out;
}

function cityState(seed: number, days: number): GameState {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(sim.getState().config) * days);
  return sim.getState();
}

describe('ContractIndex — index-driven scans equal scan-driven scans', () => {
  it('every source/dest/owner bucket matches an ordered full scan on a live city', () => {
    // Two seeds so the churn (founders / expansions / acquisitions) differs.
    for (const seed of [11, 7]) {
      const state = cityState(seed, 150);
      const index = buildContractIndex(state);

      // There must be real, churned contracts to make this meaningful.
      const n = Object.keys(state.contracts).length;
      expect(n).toBeGreaterThan(20);

      for (const facId in state.facilities) {
        expect([...contractsBySource(index, facId)]).toEqual(scanBySource(state, facId));
        expect([...contractsByDest(index, facId)]).toEqual(scanByDest(state, facId));
      }
      for (const firmId in state.firms) {
        expect([...contractsByOwner(index, firmId)]).toEqual(scanByOwner(state, firmId));
      }

      // Total coverage: every contract lands in exactly one bucket per axis, so
      // the buckets are a partition — nothing dropped, nothing double-counted.
      let srcTotal = 0;
      for (const ids of index.bySource.values()) srcTotal += ids.length;
      let dstTotal = 0;
      for (const ids of index.byDest.values()) dstTotal += ids.length;
      let ownTotal = 0;
      for (const ids of index.byOwner.values()) ownTotal += ids.length;
      expect(srcTotal).toBe(n);
      expect(dstTotal).toBe(n);
      expect(ownTotal).toBe(n);
    }
  });

  it('an empty bucket is an empty scan (missing keys are no-ops)', () => {
    const state = cityState(4, 60);
    const index = buildContractIndex(state);
    expect([...contractsBySource(index, 'fac_does_not_exist')]).toEqual([]);
    expect([...contractsByDest(index, 'fac_does_not_exist')]).toEqual([]);
    expect([...contractsByOwner(index, 'firm_does_not_exist')]).toEqual([]);
  });

  it('appending a new contract matches a from-scratch rebuild (the add-path invariant)', () => {
    const state = cityState(11, 80);
    const index = buildContractIndex(state);

    // A new contract carries the highest id and is inserted last, exactly like
    // the founder / expansion adds the mutation sites drive through addContract.
    const c: Contract = {
      id: 'ctr_synthetic_last',
      ownerFirmId: state.playerFirmId,
      sourceFacilityId: Object.keys(state.facilities)[0]!,
      destinationFacilityId: Object.keys(state.facilities)[1]!,
      productId: 'bread',
      targetQuantity: 40,
      reorderPoint: 18,
      maxInventory: 80,
      transportCost: 0,
      active: true,
    };
    state.contracts[c.id] = c;
    indexAddContract(index, c);

    const rebuilt = buildContractIndex(state);
    // Byte-for-byte the same buckets as if we had rebuilt from scratch —
    // including order — for the three keys the new contract touched.
    expect([...contractsBySource(index, c.sourceFacilityId)]).toEqual([
      ...contractsBySource(rebuilt, c.sourceFacilityId),
    ]);
    expect([...contractsByDest(index, c.destinationFacilityId)]).toEqual([
      ...contractsByDest(rebuilt, c.destinationFacilityId),
    ]);
    expect([...contractsByOwner(index, c.ownerFirmId)]).toEqual([
      ...contractsByOwner(rebuilt, c.ownerFirmId),
    ]);
  });

  it('reproduces the logistics reserved-sum exactly (the O(N^2) site it replaced)', () => {
    // The concrete computation the index removed the cliff from: for a
    // cross-firm source, sum the targetQuantity of the source firm's OWN
    // same-product contracts. Index walk and full scan must agree.
    const state = cityState(7, 120);
    const index = buildContractIndex(state);
    for (const facId in state.facilities) {
      const source = state.facilities[facId]!;
      for (const pid of ['grain', 'bread', 'minerals', 'tools', 'cotton', 'clothes']) {
        let scanReserved = 0;
        for (const cid in state.contracts) {
          const c = state.contracts[cid]!;
          if (!c.active || c.sourceFacilityId !== source.id || c.productId !== pid) continue;
          if (state.facilities[c.destinationFacilityId]?.ownerFirmId !== source.ownerFirmId) continue;
          scanReserved += c.targetQuantity;
        }
        let indexReserved = 0;
        for (const cid of contractsBySource(index, source.id)) {
          const c = state.contracts[cid]!;
          if (!c.active || c.productId !== pid) continue;
          if (state.facilities[c.destinationFacilityId]?.ownerFirmId !== source.ownerFirmId) continue;
          indexReserved += c.targetQuantity;
        }
        expect(indexReserved).toBe(scanReserved);
      }
    }
  });
});
