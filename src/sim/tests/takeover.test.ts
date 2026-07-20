import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { recordTransaction, totalMoneySupply } from '../core/GameState';
import { firmAccount } from '../core/Transactions';
import { performAcquisition } from '../core/Acquisition';
import { marketCap, boardVisibility } from '../selectors/companySelectors';
import { ACQUISITION_PREMIUM_HEALTHY } from '../data/constants';

describe('Fair takeovers — minority cash-out', () => {
  it('cashes out an outside holder at the acquisition price and conserves money', () => {
    const sim = newSim(301);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Sunrise Foods');
    const holder = findFirmByName(state, 'Loom & Thread');
    const holderBasis = 5000_00;
    holder.sharesHeld[target.id] = 20;
    holder.shareCostBasis[target.id] = holderBasis;
    player.cash = 500_000_00;

    // Price is fixed before any mutation; the holder's 20% is a fifth of it.
    const val = marketCap(state, target.id);
    const expectedPay = Math.round((val * ACQUISITION_PREMIUM_HEALTHY * 20) / 100);
    const holderCashBefore = holder.cash;
    const supplyBefore = totalMoneySupply(state);

    const ok = performAcquisition(state, player.id, target.id);
    expect(ok).toBe(true);
    expect(state.firms[target.id]).toBeUndefined();
    // The stake and its basis are fully released.
    expect(holder.sharesHeld[target.id]).toBeUndefined();
    expect(holder.shareCostBasis[target.id]).toBeUndefined();
    // Paid exactly the per-share price implied by the buyout.
    expect(holder.cash - holderCashBefore).toBe(expectedPay);
    // No money minted or burned across the whole settlement.
    expect(totalMoneySupply(state)).toBe(supplyBefore);
  });

  it('reports realized P&L against cost basis when a holder is bought out', () => {
    const sim = newSim(302);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Granite Industries');
    const holder = findFirmByName(state, 'Loom & Thread');
    // A deliberately tiny basis so the cash-out is a clear realized gain.
    holder.sharesHeld[target.id] = 15;
    holder.shareCostBasis[target.id] = 1_00;
    player.cash = 500_000_00;

    const val = marketCap(state, target.id);
    const expectedPay = Math.round((val * ACQUISITION_PREMIUM_HEALTHY * 15) / 100);
    const gain = expectedPay - 1_00;

    performAcquisition(state, player.id, target.id);

    const evt = state.events.find((e) =>
      e.message.includes('was cashed out of its 15% stake in Granite Industries'),
    );
    expect(evt).toBeTruthy();
    expect(evt!.message).toContain(gain >= 0 ? 'gain' : 'loss');
  });
});

describe('Control ladder — 40% takeover block', () => {
  it('a 40% outside stake blocks an AI acquisition of the target', () => {
    const sim = newSim(303);
    const state = sim.getState();
    const buyer = findFirmByName(state, 'Granite Industries');
    const target = findFirmByName(state, 'Sunrise Foods');
    const blocker = findFirmByName(state, 'Loom & Thread');
    blocker.sharesHeld[target.id] = 40;
    buyer.cash = 500_000_00;
    const supplyBefore = totalMoneySupply(state);

    const ok = performAcquisition(state, buyer.id, target.id);
    expect(ok).toBe(false);
    expect(state.firms[target.id]).toBeTruthy(); // target survives
    expect(totalMoneySupply(state)).toBe(supplyBefore); // nothing settled
  });

  it("a buyer's own controlling stake never blocks its own bid", () => {
    const sim = newSim(303);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Sunrise Foods');
    player.sharesHeld[target.id] = 40;
    player.cash = 500_000_00;
    const ok = performAcquisition(state, player.id, target.id);
    expect(ok).toBe(true);
    expect(state.firms[target.id]).toBeUndefined();
  });
});

describe('Control ladder — 25% board visibility', () => {
  it('exposes the target board only at or above a 25% stake', () => {
    const sim = newSim(304);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Granite Industries');

    player.sharesHeld[target.id] = 24;
    expect(boardVisibility(state, player.id, target.id)).toBeNull();

    player.sharesHeld[target.id] = 25;
    const board = boardVisibility(state, player.id, target.id);
    expect(board).not.toBeNull();
    expect(board!.cash).toBe(target.cash);
    expect(board!.facilities).toBe(target.facilities.length);
    expect(typeof board!.netProfit7d).toBe('number');
  });
});

describe('Account validation — no mint/burn on a dead counterparty', () => {
  it('throws (dev) and moves no money when the payer account is gone', () => {
    const sim = newSim(305);
    const state = sim.getState();
    const supplyBefore = totalMoneySupply(state);
    expect(() =>
      recordTransaction(state, {
        from: firmAccount('firm-does-not-exist'),
        to: firmAccount(state.playerFirmId),
        amount: 1000_00,
        firmId: null,
        category: 'none',
        note: 'ghost payer',
      }),
    ).toThrow();
    expect(totalMoneySupply(state)).toBe(supplyBefore);
  });

  it('throws (dev) and moves no money when the payee account is gone', () => {
    const sim = newSim(305);
    const state = sim.getState();
    const supplyBefore = totalMoneySupply(state);
    expect(() =>
      recordTransaction(state, {
        from: firmAccount(state.playerFirmId),
        to: firmAccount('firm-does-not-exist'),
        amount: 1000_00,
        firmId: null,
        category: 'none',
        note: 'ghost payee',
      }),
    ).toThrow();
    expect(totalMoneySupply(state)).toBe(supplyBefore);
  });
});
