/**
 * b2b-services-d4 probe — the Arc D4 two-service channel live baseline.
 *
 * The HD3 probe (b2b-services.ts) pins the COMPUTE channel; this one pins what
 * D4 adds: a SECOND service (office CONSULTING) sharing the same C2 machinery,
 * and a 'service' firm ARCHETYPE that owns provisioning. It runs the CITY preset
 * with servicesEnabled for 300 days × seeds 11/4/7 and reads (only reads) state.
 *
 * It answers what docs/design/b2b-services.md pins for D4:
 *
 *   (a) per-service adoption + coverage — contracts, seats covered, and the
 *       providers/capacity for BOTH compute and consulting;
 *   (b) per-service provider P&L — lifetime revenue, cash, and solvency, split by
 *       service (a firm that runs both, like the seeded Cirrus, counts in both);
 *   (c) the consulting BENEFIT — advisory coverage lifts ad→brand conversion, so
 *       covered advertisers build more brand per ad dollar: measured as the brand
 *       advantage of consulting subscribers over non-subscribing advertisers;
 *   (d) no cross-service billing bleed — every consulting contract's provider runs
 *       an office, every compute contract's runs a datacenter;
 *   (e) per-service subscribe/cancel churn (the hysteresis holds independently);
 *   (f) perf — ms/tick at day 300; and money conserved to the cent every seed.
 *
 * Timing uses process.hrtime (outside the sim; never touches sim state).
 *
 * Runnable: `npx tsx docs/design/probes/b2b-services-d4.ts` (DAYS / SEEDS env
 * override the 300-day length and seed list).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import { serviceCapacity, serviceSeatDemand } from '../../../src/sim/systems/ServiceBillingSystem';
import {
  SERVICE_IDS,
  getServiceDef,
  COMPUTE_SERVICE_ID,
  CONSULTING_SERVICE_ID,
  CONSULTING_BRAND_MULT,
  SERVICE_BOOST_MULT,
} from '../../../src/sim/data/services';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const CENTS = 100;
const D = (cents: number): string => (cents / CENTS).toFixed(2);

/** Subscriber firm ids for one service. */
function subscribersOf(state: GameState, serviceId: string): Set<string> {
  const set = new Set<string>();
  for (const cid in state.serviceContracts) {
    const c = state.serviceContracts[cid]!;
    if (c.serviceId === serviceId) set.add(c.subscriberFirmId);
  }
  return set;
}

/** Per-service tally: contracts, seats covered, town demand, providers, capacity,
 * provider lifetime revenue / cash / insolvency, and any cross-service bleed. */
function serviceTally(state: GameState, serviceId: string): {
  contracts: number; seatsCovered: number; seatsDemanded: number;
  providers: number; capacity: number; provRev: number; provCash: number;
  insolventProviders: number; subscribers: number; eligible: number; bleed: number;
} {
  const def = getServiceDef(serviceId);
  let contracts = 0, seatsCovered = 0, bleed = 0;
  for (const cid in state.serviceContracts) {
    const c = state.serviceContracts[cid]!;
    if (c.serviceId !== serviceId) continue;
    contracts += 1;
    seatsCovered += c.seats;
    // Bleed: a contract whose provider does not actually run this service's facility.
    if (serviceCapacity(state, state.firms[c.providerFirmId]!, def) <= 0) bleed += 1;
  }
  const subs = subscribersOf(state, serviceId);
  let seatsDemanded = 0;
  for (const fid of subs) seatsDemanded += serviceSeatDemand(state.firms[fid]!);

  let providers = 0, capacity = 0, provRev = 0, provCash = 0, insolventProviders = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    const cap = serviceCapacity(state, f, def);
    if (cap <= 0) continue;
    providers += 1; capacity += cap; provRev += f.accounting.lifetime.revenue; provCash += f.cash;
    if (f.bankruptcyStatus === 'insolvent') insolventProviders += 1;
  }
  // Eligible consumers: firms that could subscribe (not a provider of this service,
  // an operator that advertises for consulting / produces for compute).
  let eligible = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai') continue;
    if (f.strategy.archetype === 'service') continue;
    if (serviceCapacity(state, f, def) > 0) continue;
    eligible += 1;
  }
  return {
    contracts, seatsCovered, seatsDemanded, providers, capacity,
    provRev, provCash, insolventProviders, subscribers: subs.size, eligible, bleed,
  };
}

/** The consulting benefit, measured: average total brand of consulting
 * subscribers vs non-subscribing advertisers (firms with any ad budget). Covered
 * advertisers convert ad dollars to brand CONSULTING_BRAND_MULT× faster. */
function consultingBrandAdvantage(state: GameState): { sub: number; non: number; subN: number; nonN: number } {
  const subs = subscribersOf(state, CONSULTING_SERVICE_ID);
  let subBrand = 0, subN = 0, nonBrand = 0, nonN = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai' || f.strategy.archetype === 'service') continue;
    const adSpend = Object.values(f.adBudgetByProduct).reduce((s, b) => s + (b ?? 0), 0);
    if (adSpend <= 0) continue; // only advertisers — the benefit is on ad→brand
    const brand = Object.values(f.brandByProduct).reduce((s, b) => s + (b ?? 0), 0);
    if (subs.has(fid)) { subBrand += brand; subN += 1; }
    else { nonBrand += brand; nonN += 1; }
  }
  return { sub: subN > 0 ? subBrand / subN : 0, non: nonN > 0 ? nonBrand / nonN : 0, subN, nonN };
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const initialMoney = totalMoneySupply(state);

  console.log(`\n=== seed ${seed} — City + B2B services D4 (compute ${SERVICE_BOOST_MULT} / consulting ${CONSULTING_BRAND_MULT}) ===`);

  let worstConserved = 0;
  const prev: Record<string, Set<string>> = {};
  const churn: Record<string, number> = {};
  for (const sid of SERVICE_IDS) { prev[sid] = new Set(); churn[sid] = 0; }
  let winNs = 0n, winTicks = 0;
  let firstConsultProvider = -1, firstConsultContract = -1;

  for (let day = 1; day <= DAYS; day++) {
    const t0 = process.hrtime.bigint();
    sim.run(tpd);
    winNs += process.hrtime.bigint() - t0;
    winTicks += tpd;

    for (const sid of SERVICE_IDS) {
      const cur = new Set<string>();
      for (const cid in state.serviceContracts) if (state.serviceContracts[cid]!.serviceId === sid) cur.add(cid);
      for (const id of cur) if (!prev[sid]!.has(id)) churn[sid]! += 1;
      prev[sid] = cur;
    }
    if (firstConsultProvider < 0) {
      for (const fid in state.firms) if (serviceCapacity(state, state.firms[fid]!, getServiceDef(CONSULTING_SERVICE_ID)) > 0) { firstConsultProvider = day; break; }
    }
    if (firstConsultContract < 0 && subscribersOf(state, CONSULTING_SERVICE_ID).size > 0) firstConsultContract = day;

    const delta = Math.abs(totalMoneySupply(state) - initialMoney);
    if (delta > worstConserved) worstConserved = delta;

    if (day % 100 === 0 || day === DAYS) {
      const parts: string[] = [];
      for (const sid of SERVICE_IDS) {
        const t = serviceTally(state, sid);
        parts.push(`${sid}: ${t.contracts}c ${t.seatsCovered}/${t.seatsDemanded}seats prov${t.providers} rev ${D(t.provRev)} cash ${D(t.provCash)} bleed ${t.bleed}`);
      }
      const msPerTick = winTicks > 0 ? Number(winNs) / 1e6 / winTicks : 0;
      console.log(`d${String(day).padStart(3)} | ${parts.join(' || ')} | ${msPerTick.toFixed(3)}ms/t consΔ ${delta}c`);
      winNs = 0n; winTicks = 0;
    }
  }

  // Final machine-readable summary.
  const perService: Record<string, unknown> = {};
  for (const sid of SERVICE_IDS) {
    const t = serviceTally(state, sid);
    perService[sid] = {
      contracts: t.contracts,
      seatsCovered: t.seatsCovered,
      seatsDemanded: t.seatsDemanded,
      providers: t.providers,
      providerCapacity: t.capacity,
      providerLifetimeRevenue: D(t.provRev),
      providerCash: D(t.provCash),
      insolventProviders: t.insolventProviders,
      subscribers: t.subscribers,
      adoptionPct: t.subscribers + t.eligible > 0 ? ((t.subscribers / (t.subscribers + t.eligible)) * 100).toFixed(0) : '0',
      crossServiceBleed: t.bleed,
      churnPerDay: (churn[sid]! / DAYS).toFixed(3),
    };
  }
  const brand = consultingBrandAdvantage(state);
  console.log(JSON.stringify({
    seed,
    day: DAYS,
    firstConsultingProviderDay: firstConsultProvider,
    firstConsultingContractDay: firstConsultContract,
    serviceFirms: Object.values(state.firms).filter((f) => f.strategy.archetype === 'service').length,
    perService,
    consultingBenefit: {
      subscriberAvgBrand: brand.sub.toFixed(2),
      nonSubscriberAvgBrand: brand.non.toFixed(2),
      brandAdvantagePct: brand.non > 0 ? (((brand.sub / brand.non) - 1) * 100).toFixed(1) : 'n/a',
      subscriberN: brand.subN,
      nonSubscriberN: brand.nonN,
    },
    perf: { engineAvgTickMs: state.perf.avgTickMs.toFixed(3) },
    conservation: { worstDeltaCents: worstConserved, conservedToCent: worstConserved === 0 },
  }, null, 1));
}
