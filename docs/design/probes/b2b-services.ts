/**
 * b2b-services probe — the HD3 compute-channel live baseline.
 *
 * Runs the CITY preset with the B2B services channel ON (servicesEnabled) for
 * 300 days × seeds 11/4/7 and measures the firm-to-firm compute economy the
 * ServiceBillingSystem produces. It only reads state. It answers what the
 * design doc needs to pin:
 *
 *   (a) adoption — how many eligible AI firms subscribe at boost = 1.06, and
 *       how many seats are covered vs demanded;
 *   (b) provider health — the seeded provider's revenue, cash, and solvency;
 *   (c) the boost's effect — do subscriber firms out-produce non-subscribers
 *       (avg units/day per producing facility)?
 *   (d) hysteresis — subscribe/cancel churn per day (must not flap);
 *   (e) perf — ms/tick at day 300;
 *   (f) money conserved to the cent on every seed.
 *
 * Timing uses process.hrtime (outside the sim; never touches sim state).
 *
 * Runnable: `npx tsx docs/design/probes/b2b-services.ts` (DAYS / SEEDS env
 * override the 300-day length and seed list).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import {
  computeCapacity,
  computeSeatDemand,
} from '../../../src/sim/systems/ServiceBillingSystem';
import { SERVICE_BOOST_MULT } from '../../../src/sim/data/services';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const CENTS = 100;
const D = (cents: number): string => (cents / CENTS).toFixed(2);

const PRODUCING = new Set(['farm', 'mine', 'factory']);

function subscribers(state: GameState): Set<string> {
  const set = new Set<string>();
  for (const cid in state.serviceContracts) set.add(state.serviceContracts[cid]!.subscriberFirmId);
  return set;
}

/** Avg units/day per producing facility, split by subscriber status. */
function outputSplit(state: GameState): { sub: number; non: number; subFacs: number; nonFacs: number } {
  const subs = subscribers(state);
  let subUnits = 0, subFacs = 0, nonUnits = 0, nonFacs = 0;
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (!PRODUCING.has(fac.type) || fac.status === 'closed') continue;
    const owner = state.firms[fac.ownerFirmId];
    if (!owner || (owner.ownerType !== 'ai' && owner.ownerType !== 'player')) continue;
    const units = fac.yesterdayStats.unitsProduced;
    if (subs.has(fac.ownerFirmId)) { subUnits += units; subFacs += 1; }
    else { nonUnits += units; nonFacs += 1; }
  }
  return {
    sub: subFacs > 0 ? subUnits / subFacs : 0,
    non: nonFacs > 0 ? nonUnits / nonFacs : 0,
    subFacs, nonFacs,
  };
}

function aiEligible(state: GameState): number {
  let n = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType === 'ai' && computeCapacity(state, f) === 0) n += 1;
  }
  return n;
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const initialMoney = totalMoneySupply(state);

  console.log(`\n=== seed ${seed} — City + B2B services (boost ${SERVICE_BOOST_MULT}) ===`);

  let worstConserved = 0;
  let churn = 0;
  let prevContracts = new Set<string>();
  let winNs = 0n, winTicks = 0;

  for (let day = 1; day <= DAYS; day++) {
    const t0 = process.hrtime.bigint();
    sim.run(tpd);
    winNs += process.hrtime.bigint() - t0;
    winTicks += tpd;

    const cur = new Set(Object.keys(state.serviceContracts));
    for (const id of cur) if (!prevContracts.has(id)) churn++;
    prevContracts = cur;

    const delta = Math.abs(totalMoneySupply(state) - initialMoney);
    if (delta > worstConserved) worstConserved = delta;

    if (day % 50 === 0 || day === DAYS) {
      const contracts = Object.values(state.serviceContracts);
      const seatsCovered = contracts.reduce((s, c) => s + c.seats, 0);
      const subs = subscribers(state);
      let seatsDemanded = 0;
      for (const fid of subs) seatsDemanded += computeSeatDemand(state.firms[fid]!);
      const split = outputSplit(state);
      // Provider tally.
      let provCapacity = 0, provRev = 0, provCash = 0, providers = 0;
      for (const fid in state.firms) {
        const f = state.firms[fid]!;
        const cap = computeCapacity(state, f);
        if (cap > 0) { providers++; provCapacity += cap; provRev += f.accounting.lifetime.revenue; provCash += f.cash; }
      }
      const eligible = aiEligible(state);
      const adoption = eligible + subs.size > 0 ? subs.size / (subs.size + eligible) : 0;
      const msPerTick = winTicks > 0 ? Number(winNs) / 1e6 / winTicks : 0;
      console.log(
        `d${String(day).padStart(3)} contracts ${contracts.length} seats ${seatsCovered}/${seatsDemanded}dem cap ${provCapacity} | ` +
        `providers ${providers} rev ${D(provRev)} cash ${D(provCash)} | ` +
        `adoption ${(adoption * 100).toFixed(0)}% subs ${subs.size} | ` +
        `out sub ${split.sub.toFixed(1)} non ${split.non.toFixed(1)} (${split.subFacs}/${split.nonFacs} facs) | ` +
        `${msPerTick.toFixed(3)}ms/t consΔ ${delta}c`,
      );
      winNs = 0n; winTicks = 0;
    }
  }

  // Final summary line (machine-readable).
  const contracts = Object.values(state.serviceContracts);
  const subs = subscribers(state);
  const split = outputSplit(state);
  let provRev = 0, provCash = 0, provCapacity = 0, providers = 0, insolventProviders = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    const cap = computeCapacity(state, f);
    if (cap > 0) {
      providers++; provCapacity += cap; provRev += f.accounting.lifetime.revenue; provCash += f.cash;
      if (f.bankruptcyStatus === 'insolvent') insolventProviders++;
    }
  }
  const eligible = aiEligible(state);
  console.log(JSON.stringify({
    seed,
    day: DAYS,
    contracts: contracts.length,
    seatsCovered: contracts.reduce((s, c) => s + c.seats, 0),
    providers,
    providerCapacity: provCapacity,
    providerLifetimeRevenue: D(provRev),
    providerCash: D(provCash),
    insolventProviders,
    aiSubscribers: subs.size,
    aiEligible: eligible,
    adoptionPct: subs.size + eligible > 0 ? ((subs.size / (subs.size + eligible)) * 100).toFixed(0) : '0',
    subOutPerFac: split.sub.toFixed(2),
    nonOutPerFac: split.non.toFixed(2),
    outAdvantagePct: split.non > 0 ? (((split.sub / split.non) - 1) * 100).toFixed(1) : 'n/a',
    subscribeEventsTotal: churn,
    churnPerDay: (churn / DAYS).toFixed(3),
    perf: { engineAvgTickMs: state.perf.avgTickMs.toFixed(3) },
    conservation: { worstDeltaCents: worstConserved, conservedToCent: worstConserved === 0 },
  }, null, 1));
}
