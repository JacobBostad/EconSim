import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { sellRefund } from '../core/Demolition';
import { cityPrice } from '../core/Trade';
import { getProduct } from '../data/products';
import { TRADE_CITY_IDS } from '../data/tradeCities';
import { poolCoverMult } from '../data/tradePool';
import { getQuantity } from '../entities/Inventory';
import { companyValuation, marketCap, operatingValuationOf } from '../selectors/companySelectors';
import { smoothedProfitBase } from '../systems/DividendSystem';
import {
  computeCapacity,
  listedComputePrice,
  computeSeatDemand,
} from '../systems/ServiceBillingSystem';
import { forwardMark } from '../systems/ForwardSystem';

/**
 * Bot v8 — the archetype-era (world-scale City) integration regression. Where
 * v7 pinned the pillar-era desk/delegation strategy on a Village, v8 plays the
 * systems that only exist in a full City world: the specialist archetypes and
 * the Arc E trade pool. A competent player, handed all the era flags, still
 * ends solvent with a materially larger book — and every new channel leaves its
 * fingerprint:
 *   D2  lease a premises from a founded landlord (rent billed, $0 upfront);
 *   C2  subscribe to a compute provider once it prices reasonably;
 *   B2  take a dividend stake in the highest-yield healthy rival (player parity);
 *   B3  sign a forward on a city spike, then close it early at the mark;
 *   E   export a staple into a demand-pool city, moving its cover;
 *   +   sell an owned facility back for salvage.
 *
 * Entry timing is polled, never hardcoded (the landlord founds ~day 56, the
 * pool/providers exist from day 0) — the citysmoke idiom. Seed 11 is pinned
 * because it exercises every leg (probe: landlord founds day 56, a compute
 * provider quotes $2.00/seat with free seats from day 0, and firm_6 carries the
 * fattest healthy yield past day 40); seeds 4 and 7 also play all six but 11 is
 * the canonical City bit-identity seed the orchestrator re-verifies, so the bot
 * rides the same one. Any leg that genuinely can't play records a skip reason
 * (surfaced in the final assertion) instead of hard-failing, and the rest still
 * assert; on the pinned seed all six fire, so the final check demands them all.
 */

const CITY_CONFIG = {
  ...DEFAULT_CONFIG,
  sizePreset: 'city' as const,
  servicesEnabled: true,
  realEstateEnabled: true,
  investorsEnabled: true,
  tradeDemandPoolsEnabled: true,
};

/** Reasonable compute price bar: at or below $3/seat/day (base is $2, cap $6). */
const COMPUTE_PRICE_BAR = 300;
const POOL_CITY = 'port_rosa';

describe('Scripted 250-day playtest (bot v8, archetype/City era)', () => {
  it('the specialist channels and the trade pool carry a City firm together', () => {
    const sim = new Simulation(createInitialState(11, CITY_CONFIG));
    sim.dispatch({ type: 'RESUME' });
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    player.cash = 60000_00;
    const supply0 = totalMoneySupply(state);
    const netWorth0 = companyValuation(state, player.id).valuation;

    const facs = () => player.facilities.map((i) => state.facilities[i]!).filter(Boolean);
    const warehouse = () => facs().find((f) => f.type === 'warehouse');
    const factory = () => facs().find((f) => f.type === 'factory');

    // --- leg trackers ---------------------------------------------------------
    let stage = 0;
    // D2 lease
    let leasedFacilityId: string | null = null;
    let leaseLandlordId: string | null = null;
    // C2 compute
    let computeContractId: string | null = null;
    // B2 stake
    let stakeTarget: string | null = null;
    // B3 forward
    let openForwardId: string | null = null;
    let forwardSignedDay = -1;
    let forwardClosed = false;
    let closedForwardPnL: number | null = null;
    let forwardCloseSettled = false;
    // Arc E pool export
    let poolExports = 0;
    let poolCoverBefore = 1;
    let poolCoverAfter = 1;
    // salvage
    let soldRefund = 0;

    const bestBreadCity = (): string =>
      TRADE_CITY_IDS.reduce((a, b) => (cityPrice(state, a, 'bread') >= cityPrice(state, b, 'bread') ? a : b));

    for (let d = 0; d < 250; d++) {
      const day = computeTime(state.tick, state.config).day;

      // Day 0: stand up the staple business — a self-managing bread chain, a
      // warehouse to stage exports, a factory→warehouse feed, and a hired store
      // manager so the shop is priced by delegation (the v7 idiom).
      if (stage === 0) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 104, y: 20 } });
        const wh = warehouse();
        const fac = factory();
        const shop = facs().find((f) => f.type === 'retail');
        if (wh && fac && shop) {
          sim.dispatch({
            type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: player.id,
            sourceFacilityId: fac.id, destinationFacilityId: wh.id,
            productId: 'bread', targetQuantity: 8, reorderPoint: 400, maxInventory: 999,
          });
          sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 1 });
          stage = 1;
        }
      }

      // --- C2: subscribe to compute once a provider prices reasonably ---------
      if (stage >= 1 && !computeContractId && day >= 8 && computeSeatDemand(player) > 0) {
        for (const fid of Object.keys(state.firms).sort()) {
          if (fid === player.id) continue;
          const prov = state.firms[fid]!;
          const cap = computeCapacity(state, prov);
          if (cap <= 0) continue;
          let sold = 0;
          for (const cid in state.serviceContracts) {
            const c = state.serviceContracts[cid]!;
            if (c.providerFirmId === fid) sold += c.seats;
          }
          if (cap - sold <= 0) continue;
          if (listedComputePrice(prov) > COMPUTE_PRICE_BAR) continue;
          sim.dispatch({ type: 'SUBSCRIBE_SERVICE', firmId: player.id, providerFirmId: fid });
          const mine = Object.keys(state.serviceContracts).find(
            (cid) => state.serviceContracts[cid]!.subscriberFirmId === player.id,
          );
          if (mine) computeContractId = mine;
          break;
        }
      }

      // --- B2: take a dividend stake in the fattest-yield healthy rival -------
      if (!stakeTarget && day >= 45) {
        let best = 0;
        let target: string | null = null;
        for (const fid of Object.keys(state.firms).sort()) {
          if (fid === player.id) continue;
          const other = state.firms[fid]!;
          if (other.ownerType !== 'ai' && other.ownerType !== 'player') continue;
          if (other.bankruptcyStatus !== 'healthy') continue;
          const base = smoothedProfitBase(other);
          if (base <= 0) continue;
          if (operatingValuationOf(state, fid) <= 0) continue;
          const mcap = marketCap(state, fid);
          if (mcap <= 0) continue;
          const y = base / mcap;
          if (y > best) { best = y; target = fid; }
        }
        if (target) {
          sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 5 });
          if ((player.sharesHeld[target] ?? 0) > 0) stakeTarget = target;
        }
      }

      // --- B3: lock a forward when a city bread price spikes, then close it
      // early at the mark once the walk reverts (a short pays when the market
      // falls back under the lock). Delivery is set to the far edge of the
      // window so the early close always lands first; a stubborn market is
      // closed at a deadline rather than ridden to settlement.
      if (stage >= 1 && !openForwardId && !forwardClosed && day >= 20 && day <= 180 && player.forwards.length < 2) {
        const cid = bestBreadCity();
        if (cityPrice(state, cid, 'bread') >= getProduct('bread').basePrice * 1.15) {
          sim.dispatch({ type: 'SELL_FORWARD', firmId: player.id, productId: 'bread', quantity: 60, cityId: cid, deliveryDay: day + 10 });
          const signed = player.forwards[player.forwards.length - 1];
          if (signed && player.forwards.some((f) => f.id === signed.id)) {
            openForwardId = signed.id;
            forwardSignedDay = day;
          }
        }
      }
      if (openForwardId) {
        const fwd = player.forwards.find((f) => f.id === openForwardId);
        if (fwd) {
          const mark = forwardMark(state, fwd);
          if (mark > 0 || day >= forwardSignedDay + 8) {
            sim.dispatch({ type: 'CLOSE_FORWARD', firmId: player.id, forwardId: openForwardId });
            if (!player.forwards.some((f) => f.id === openForwardId)) {
              forwardClosed = true;
              // Derive realized P&L from the RECORDED transactions, not the
              // pre-close mark read above: closeForward releases the signing
              // hedge's price impact BEFORE marking (by design — a sign-then-
              // close round trip nets the spread it paid), so the mark the
              // player actually settles at differs from the stale read. The
              // review caught the stale value asserting a fabricated win while
              // the real seed-11 close settles at a small loss; the honest
              // artifact is settlement-minus-fee straight off the ledger.
              let settled = 0;
              let fee = 0;
              for (const t of state.transactions) {
                if (t.note?.startsWith('Closed forward at mark')) {
                  settled = t.from.kind === 'world' ? t.amount : -t.amount;
                }
                if (t.note?.startsWith('Forward close fee')) fee = t.amount;
              }
              closedForwardPnL = settled - fee;
              forwardCloseSettled = state.transactions.some((t) => t.note?.includes('Closed forward at mark'));
              openForwardId = null;
            }
          }
        } else {
          openForwardId = null;
        }
      }

      // --- Arc E: export a staple into the demand pool, watching cover --------
      const wh = warehouse();
      if (
        wh && poolExports < 3 && day >= 24 && day <= 200 &&
        getQuantity(wh.inputInventory, 'bread') + getQuantity(wh.outputInventory, 'bread') >= 50
      ) {
        const pool = state.tradeCities[POOL_CITY]!.pool;
        if (pool) {
          const invBefore = pool.inventory['bread'] ?? 0;
          poolCoverBefore = poolCoverMult(POOL_CITY, 'bread', invBefore);
          sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 50, cityId: POOL_CITY });
          const invAfter = pool.inventory['bread'] ?? 0;
          poolCoverAfter = poolCoverMult(POOL_CITY, 'bread', invAfter);
          if (invAfter > invBefore) poolExports += 1;
        }
      }

      // --- D2: lease a premises from a landlord once one has founded ----------
      if (!leasedFacilityId && day >= 56) {
        const landlord = Object.values(state.firms).find(
          (f) => f.strategy.archetype === 'landlord' && f.id !== player.id && f.bankruptcyStatus === 'healthy',
        );
        if (landlord) {
          const before = new Set(player.facilities);
          sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 118, y: 118 }, leaseFrom: landlord.id });
          const leased = facs().find((f) => !before.has(f.id) && f.landlordFirmId === landlord.id);
          if (leased) {
            leasedFacilityId = leased.id;
            leaseLandlordId = landlord.id;
          }
        }
      }

      // --- salvage: sell the warehouse back once its export work is done ------
      if (day === 240 && wh && soldRefund === 0) {
        const cashBefore = player.cash;
        sim.dispatch({ type: 'SELL_FACILITY', firmId: player.id, facilityId: wh.id });
        if (!state.facilities[wh.id]) soldRefund = player.cash - cashBefore;
      }

      // Keep every producing facility staffed (v7's target-2 idiom).
      for (const fac of facs()) {
        const target = fac.type === 'home' || fac.defId === 'apartment' ? 0 : 2;
        if (fac.employees.length < target) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
      }

      sim.run(tpd);
    }

    // --- day-250 scorecard (seed 11, measured) --------------------------------
    // Floors sit well under the seed-11 measurements so seed-adjacent drift
    // doesn't flake, matching the v7 convention.
    const netWorth = companyValuation(state, player.id).valuation;
    const leaseRent = player.accounting.lifetime.rentExpense;
    const serviceSpend = player.accounting.lifetime.serviceExpense;

    // The absolutes hold no matter which legs played: the whole run conserves to
    // the cent, the player never entered receivership, net worth grew meaningfully
    // ($60.0k → $68.2k, +$8.2k; floor at +$3k), and the heaviest bot (all City
    // channels live) stays well inside the perf guard (measured 0.35 ms/tick).
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.bankruptcyStatus).toBe('healthy');
    expect(netWorth).toBeGreaterThan(netWorth0 + 3000_00);
    expect(state.perf.avgTickMs).toBeLessThan(2);

    // Each channel's artifact is asserted only if the channel actually played;
    // a leg that genuinely couldn't play (e.g. no landlord ever founds) records
    // a reason instead of a hard failure — "SKIP that leg and assert the rest".
    // On the pinned seed 11 all six play, so `skipped` must be empty: the final
    // check is both the log (its contents name any regressed leg) and the pin.
    const skipped: string[] = [];

    // D2 — a premises was leased, not bought: the landlord owns it on book, the
    // player operates it, rent is positive and actually billed ($194 over ~194
    // days), and the tenant cannot sell premises it doesn't own.
    if (leasedFacilityId !== null) {
      const leased = state.facilities[leasedFacilityId]!;
      expect(leased.landlordFirmId).toBe(leaseLandlordId);
      expect(leased.ownerFirmId).toBe(player.id);
      expect(leased.rentPerDay!).toBeGreaterThan(0);
      expect(sellRefund(state, player.id, leased.id)).toBeNull();
      expect(leaseRent).toBeGreaterThan(0);
    } else {
      skipped.push('D2 lease: no solvent landlord founded and able to finance a premises by day 250');
    }

    // C2 — a compute subscription was opened at a reasonable price, billed
    // ($24.81 lifetime), and the coverage boost landed (serviceBoost 1.06).
    if (computeContractId !== null) {
      expect(serviceSpend).toBeGreaterThan(0);
      expect(player.serviceBoost).toBeGreaterThan(1);
    } else {
      skipped.push('C2 compute: no provider quoted at/under the price bar with free seats');
    }

    // B2 — a dividend stake in the fattest-yield healthy rival (firm_6, 5%) that
    // actually paid: $24.65 of dividend income booked (player parity with the
    // holdco path).
    if (stakeTarget !== null) {
      expect(player.sharesHeld[stakeTarget] ?? 0).toBeGreaterThanOrEqual(5);
      expect(player.accounting.lifetime.dividendIn).toBeGreaterThan(0);
    } else {
      skipped.push('B2 stake: no healthy rival carried a positive trailing yield');
    }

    // B3 — a forward was locked on a bread spike and closed early at the mark,
    // settled firm↔world through recordTransaction, leaving no open position.
    // The realized P&L is read off the ledger (settlement − fee) and is a SMALL
    // LOSS on seed 11 (−$16.85): closeForward releases the signing hedge before
    // marking, so the round trip nets the spread it paid — the anti-arbitrage
    // design working as intended, not a bug. The artifact asserted is that the
    // close SETTLED, its recorded P&L is present and bounded (a paper position
    // can never realize more than its notional in either direction), and the
    // position is gone — not a fabricated win (review blocker on the draft,
    // which asserted a stale pre-release mark).
    if (forwardClosed) {
      expect(forwardCloseSettled).toBe(true);
      expect(closedForwardPnL).not.toBeNull();
      const notional = getProduct('bread').basePrice * 60;
      expect(Math.abs(closedForwardPnL!)).toBeLessThan(notional);
      expect(player.forwards.length).toBe(0);
    } else {
      skipped.push('B3 forward: no bread city reached the 1.15× spike bar to lock against');
    }

    // Arc E — three staple exports landed in Port Rosa's demand pool and each
    // pushed its cover down (larder over target → an export discount): the pool
    // cover moved (1.00 → 0.91 mult across the dumps).
    if (poolExports > 0) {
      expect(poolExports).toBeGreaterThanOrEqual(3);
      expect(state.tradeCities[POOL_CITY]!.pool).toBeTruthy();
      expect(poolCoverAfter).toBeLessThan(poolCoverBefore);
    } else {
      skipped.push('Arc E pool: warehouse never staged enough bread to export');
    }

    // Salvage — the warehouse sold back for a positive refund ($1,584) and is
    // gone from the book.
    if (soldRefund > 0) {
      expect(facs().some((f) => f.type === 'warehouse')).toBe(false);
    } else {
      skipped.push('salvage: no owned facility was sold back');
    }

    // Pinned-seed guarantee: seed 11 exercises every leg, so nothing skipped.
    // A non-empty array here is a regression, and its contents say which leg.
    expect(skipped).toEqual([]);
  }, 60000);
});
