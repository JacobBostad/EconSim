/**
 * regionMoney.test.ts — the region-wide money primitive (region.md step 4,
 * slice 2). The account-resolution trio (under recordTransaction) and the
 * totalMoneySupply conservation sum now iterate EVERY town's holders in sorted
 * town order, not just the flat `towns.home` aliases.
 *
 * The shipped isolation probe's `regionMoneySupply` (docs/design/probes/
 * second-town-isolation.ts) is the oracle: totalMoneySupply must equal that
 * region-wide sum. We prove it (1) on a live City state where only `home` exists
 * (the identity case the pins already guard) and (2) with a hand-attached partner
 * town holding cash-bearing holders (region-unique ids, no town-factory
 * dependency — slice 2 stays independent of slice 1), where resolution and the
 * sum must reach BOTH towns and conservation must hold through a settlement
 * against a partner-town account.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, type SimulationConfig } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { Simulation } from '../core/Simulation';
import {
  totalMoneySupply,
  canAfford,
  recordTransaction,
  type GameState,
} from '../core/GameState';
import {
  firmAccount,
  citizenAccount,
  cohortAccount,
  WORLD_ACCOUNT,
} from '../core/Transactions';
import { HOME_TOWN_ID, type TownId, type TownRecords } from '../core/Town';

const PARTNER_ID: TownId = 'port_rosa';

function cityConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
  };
}

/**
 * The isolation probe's region-wide sum, replicated here as the reference: every
 * town's firms + citizens + cohorts (sorted) plus the one shared world account.
 * Kept byte-for-byte with docs/design/probes/second-town-isolation.ts.
 */
function regionMoneySupply(state: GameState): number {
  let sum = state.worldCash;
  for (const tid of Object.keys(state.towns).sort()) {
    const t = state.towns[tid]!;
    for (const id of Object.keys(t.firms).sort()) sum += t.firms[id]!.cash;
    for (const id of Object.keys(t.citizens).sort()) sum += t.citizens[id]!.cash;
    for (const id of Object.keys(t.cohorts).sort()) sum += t.cohorts[id]!.cashPool;
  }
  return sum;
}

const PARTNER_FIRM_CASH = 5_000_00;
const PARTNER_CIT_CASH = 300_00;
const PARTNER_COHORT_CASH = 700_00;

/**
 * A minimal partner town's records with cash-bearing holders. Region-unique ids
 * (a `partner_` namespace, so no collision with home's shared-counter ids); only
 * the cash fields the money primitive reads are populated. No factory call — this
 * keeps slice 2 independent of slice 1's town factory.
 */
function makePartnerRecords(): TownRecords {
  return {
    districts: {},
    marketStats: {},
    facilities: {},
    firms: { partner_firm_1: { id: 'partner_firm_1', cash: PARTNER_FIRM_CASH } },
    citizens: { partner_cit_1: { id: 'partner_cit_1', cash: PARTNER_CIT_CASH } },
    cohorts: {
      partner_cohort_1: { id: 'partner_cohort_1', cashPool: PARTNER_COHORT_CASH },
    },
  } as unknown as TownRecords;
}

describe('region-wide money primitive (step 4, slice 2)', () => {
  it('totalMoneySupply equals the probe region-wide sum on a live City state', () => {
    const s = createInitialState(11, cityConfig());
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 20);

    // One-town region: the outer loop is just `home`. The primitive and the
    // probe's oracle must agree exactly.
    expect(totalMoneySupply(s)).toBe(regionMoneySupply(s));
  });

  it('resolves and sums across BOTH towns and conserves through a partner settlement', () => {
    const s = createInitialState(11, cityConfig());
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 5);

    const homeOnly = totalMoneySupply(s);

    // Attach an inert partner town with cash-bearing holders.
    s.towns[PARTNER_ID] = makePartnerRecords();
    const partnerHolders = PARTNER_FIRM_CASH + PARTNER_CIT_CASH + PARTNER_COHORT_CASH;

    // The sum now spans both towns, and still equals the probe oracle.
    expect(totalMoneySupply(s)).toBe(homeOnly + partnerHolders);
    expect(totalMoneySupply(s)).toBe(regionMoneySupply(s));

    // Account resolution reaches the partner town's firms, citizens, cohorts.
    expect(canAfford(s, firmAccount('partner_firm_1'), PARTNER_FIRM_CASH)).toBe(true);
    expect(canAfford(s, firmAccount('partner_firm_1'), PARTNER_FIRM_CASH + 1)).toBe(false);
    expect(canAfford(s, citizenAccount('partner_cit_1'), PARTNER_CIT_CASH)).toBe(true);
    expect(canAfford(s, cohortAccount('partner_cohort_1'), PARTNER_COHORT_CASH)).toBe(true);

    // Conservation through recordTransaction against a partner-town account. In
    // dev (vitest) recordTransaction THROWS on an unresolved account, so these
    // calls not throwing is itself proof the partner account resolves region-wide
    // (before this slice, `to: partner_firm_1` pointed at nothing in home).
    const before = totalMoneySupply(s);

    recordTransaction(s, {
      from: WORLD_ACCOUNT,
      to: firmAccount('partner_firm_1'),
      amount: 1_000_00,
      firmId: null,
      category: 'revenue',
    });
    expect(totalMoneySupply(s)).toBe(before);
    expect(s.towns[PARTNER_ID]!.firms['partner_firm_1']!.cash).toBe(PARTNER_FIRM_CASH + 1_000_00);

    // Inter-town settlement: partner firm pays a home firm. Money crosses the
    // town boundary and the region total is invariant (Δ = 0).
    const homeFirmId = Object.keys(s.towns[HOME_TOWN_ID]!.firms).sort()[0]!;
    const homeFirmBefore = s.towns[HOME_TOWN_ID]!.firms[homeFirmId]!.cash;
    recordTransaction(s, {
      from: firmAccount('partner_firm_1'),
      to: firmAccount(homeFirmId),
      amount: 2_000_00,
      firmId: null,
      category: 'revenue',
    });
    expect(totalMoneySupply(s)).toBe(before);
    expect(s.towns[PARTNER_ID]!.firms['partner_firm_1']!.cash).toBe(PARTNER_FIRM_CASH - 1_000_00);
    expect(s.towns[HOME_TOWN_ID]!.firms[homeFirmId]!.cash).toBe(homeFirmBefore + 2_000_00);
  });
});
