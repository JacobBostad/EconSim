/**
 * second-town-isolation — the de-risking probe for region.md step 4 (a second
 * genuinely simulated town). The step-4 equivalent of A3's shadow-parity spike:
 * it measures the two properties the design leans on BEFORE any implementation
 * slice lands, and it reads/simulates ONLY — it changes no sim code.
 *
 * Step 4 attaches a second `TownRecords` at `state.towns['port_rosa']` and, in a
 * later slice, ticks its systems with `ctx.townId` varied. Two questions must be
 * answered before that lands, and both are answerable today with the seam
 * already in the tree (`townOf`, `installTownAliases`, `TownRecords`, the
 * `towns` map):
 *
 *  (1) ISOLATION — does attaching a second town key perturb the home economy?
 *      A home-town system routes through `townOf(state, 'home')` (reads
 *      `towns.home`) or a flat alias (also `towns.home`), so a `towns.port_rosa`
 *      record should be INVISIBLE to it. "Leakage" = any home read that saw the
 *      partner (home rngState / serialized `towns.home` drifts when the partner
 *      is present) or any home write that mutated the partner (serialized
 *      `towns.port_rosa` changes across a home-only run). We detect both by
 *      diffing a control run (no partner) against a treatment run (partner
 *      attached), byte for byte.
 *
 *  (2) THE MONEY DEBT — the deliberately-flat region-wide money primitive
 *      (`totalMoneySupply`, and the account-resolution trio under
 *      `recordTransaction`) reads the FLAT `state.firms`/`.citizens`/`.cohorts`
 *      aliases, which point at `towns.home` ONLY. The moment a second town holds
 *      money, that primitive silently omits it — conservation would break and an
 *      account in the partner town would not resolve. We measure the omission
 *      exactly (it equals the partner town's cash) and show a region-aware
 *      aggregator that closes it. This is the change region.md step 4 § "The
 *      seam's debts" specifies; the probe is the evidence it is real and that the
 *      fix conserves.
 *
 * Note on scope: this probe does NOT tick the partner town — that needs the
 * dispatch change step 4 introduces (an outer town loop / TownScheduler). It
 * attaches an INERT partner (a real second economy's records, lifted from a
 * second createInitialState) to prove the seam isolates home and to quantify the
 * money debt. That is exactly the pre-implementation evidence the design needs.
 *
 * Runnable: `npx tsx docs/design/probes/second-town-isolation.ts`
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import type { SimulationConfig } from '../../../src/sim/core/SimulationConfig';
import { HOME_TOWN_ID, type TownId, type TownRecords } from '../../../src/sim/core/Town';
import { serialize } from '../../../src/sim/persistence/saveLoad';
import { createHash } from 'crypto';

const PARTNER_ID: TownId = 'port_rosa';

/** All flags on, City preset — the richest home economy to stress isolation. */
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

/** Stable hash of one town's six record families (order-independent of `state`). */
function hashTown(records: TownRecords): string {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0, 16);
}

/**
 * The region-aware money sum step 4 makes `totalMoneySupply` become: every
 * town's firms + citizens + cohorts, plus the one shared world account. Defined
 * HERE (not in sim code) so the probe can contrast it with today's flat
 * primitive without touching the tree.
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

/** Sum of a single town's holder cash (the amount the flat primitive omits). */
function townCash(records: TownRecords): number {
  let sum = 0;
  for (const id in records.firms) sum += records.firms[id]!.cash;
  for (const id in records.citizens) sum += records.citizens[id]!.cash;
  for (const id in records.cohorts) sum += records.cohorts[id]!.cashPool;
  return sum;
}

/** Build an inert partner town's records by lifting a second City economy's
 * home records. Real firms/citizens/cohorts/facilities/marketStats/districts —
 * a genuine second economy, just not (yet) ticked. */
function buildPartnerRecords(seed: number): TownRecords {
  const partnerState = createInitialState(seed, cityConfig());
  // Warm it a few days so it holds a non-trivial, lived-in money distribution.
  const warm = new Simulation(partnerState);
  warm.dispatch({ type: 'RESUME' });
  warm.run(ticksPerDay(partnerState.config) * 10);
  return partnerState.towns[HOME_TOWN_ID]!;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('=== second-town-isolation probe (region.md step 4 de-risk) ===\n');

// ---------------------------------------------------------------------------
// (0) FLAG-OFF ANCHOR — the pinned Village seed-11 300-day rngState still holds.
// Step 4 must be gated so a Village/City pinned game is byte-identical; with no
// partner town attached, today's game IS the flag-off case. This reproduces the
// house-rule pin (village 11 → 3274842624) as the anchor everything else builds
// on.
// ---------------------------------------------------------------------------
console.log('(0) Flag-off anchor — pinned Village seed-11 300-day rngState');
{
  const s = createInitialState(11); // default preset = village, all flags off
  const sim = new Simulation(s);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(s.config) * 300);
  check('village 11 rngState === 3274842624 (conserved)', s.rngState === 3274842624,
    `got ${s.rngState}`);
}

// ---------------------------------------------------------------------------
// (1) ISOLATION — attach an inert partner town; the home economy must be
// byte-identical to a control run with no partner, and the partner must be
// untouched by the home-only tick loop.
// ---------------------------------------------------------------------------
console.log('\n(1) Isolation — home byte-identity + partner untouched (City, seed 11, 30d)');
const DAYS = 30;
{
  // Control: no partner town.
  const ctrl = createInitialState(11, cityConfig());
  const ctrlSim = new Simulation(ctrl);
  ctrlSim.dispatch({ type: 'RESUME' });
  ctrlSim.run(ticksPerDay(ctrl.config) * DAYS);
  const ctrlRng = ctrl.rngState;
  const ctrlHome = hashTown(ctrl.towns[HOME_TOWN_ID]!);

  // Treatment: identical seed/config, but with an inert partner attached before
  // the run. The partner is a DIFFERENT-seed economy so its records are visibly
  // distinct from home (a leak would show).
  const trt = createInitialState(11, cityConfig());
  const partner = buildPartnerRecords(4);
  trt.towns[PARTNER_ID] = partner;
  const partnerBefore = hashTown(partner);
  const homeSupplyBefore = totalMoneySupply(trt); // flat primitive: home + world
  const trtSim = new Simulation(trt);
  trtSim.dispatch({ type: 'RESUME' });
  trtSim.run(ticksPerDay(trt.config) * DAYS);
  const trtRng = trt.rngState;
  const trtHome = hashTown(trt.towns[HOME_TOWN_ID]!);
  const partnerAfter = hashTown(trt.towns[PARTNER_ID]!);
  const homeSupplyAfter = totalMoneySupply(trt);

  check('home rngState identical with/without partner (no read-leak into rng)',
    trtRng === ctrlRng, `${trtRng} vs ${ctrlRng}`);
  check('serialized towns.home identical with/without partner (no read-leak)',
    trtHome === ctrlHome, `${trtHome} vs ${ctrlHome}`);
  check('serialized towns.port_rosa unchanged across home-only run (no write-leak)',
    partnerAfter === partnerBefore, `${partnerAfter} vs ${partnerBefore}`);
  check('home money supply conserved across the run (flat primitive, home-only)',
    homeSupplyAfter === homeSupplyBefore,
    `Δ = ${homeSupplyAfter - homeSupplyBefore}`);
}

// ---------------------------------------------------------------------------
// (2) THE MONEY DEBT — the flat primitive omits the partner town's cash, and a
// region-aware sum recovers it. This is the account-resolution + totalMoneySupply
// change step 4 § "The seam's debts" specifies.
// ---------------------------------------------------------------------------
console.log('\n(2) Money debt — flat totalMoneySupply omits the partner; region sum recovers it');
{
  const s = createInitialState(11, cityConfig());
  const partner = buildPartnerRecords(4);
  s.towns[PARTNER_ID] = partner;

  const flat = totalMoneySupply(s);          // today: home firms/citizens/cohorts + world
  const region = regionMoneySupply(s);       // step 4: every town + world
  const omitted = region - flat;
  const partnerHolders = townCash(partner);

  check('flat totalMoneySupply omits the partner town (debt is real)',
    omitted > 0, `omitted ${omitted} cents`);
  check('the omission equals exactly the partner town\'s holder cash',
    omitted === partnerHolders, `omitted ${omitted} vs partner ${partnerHolders}`);

  console.log(`     [measured] home+world (flat) = ${flat} cents`);
  console.log(`     [measured] region (home+partner+world) = ${region} cents`);
  console.log(`     [measured] partner town holder cash omitted by flat primitive = ${omitted} cents`);
}

// ---------------------------------------------------------------------------
// (3) THE ID-COLLISION HAZARD — region.md says "entity ids are region-unique
// already (nextId off shared counters)". TRUE within ONE createInitialState
// pass, but a partner minted from a SEPARATE createInitialState has its OWN
// idCounters starting from zero, so its firm/citizen ids COLLIDE with home's.
// The flat account primitive then resolves a partner id to the WRONG (home)
// holder — a silent money-corruption path. This is the concrete constraint on
// step 4's town factory: it MUST mint the partner off the region's shared
// idCounters (or namespace ids), never a fresh counter set.
// ---------------------------------------------------------------------------
console.log('\n(3) Id-collision hazard — the town factory must share the region idCounters');
{
  const s = createInitialState(11, cityConfig());
  const partner = buildPartnerRecords(4); // built from an INDEPENDENT counter set

  // 3a — independent counters DO collide (the hazard the factory must avoid).
  // Pick a cash-bearing partner firm so the mis-resolution to the wrong holder
  // is unmistakable (a $0 world-firm collision would understate it).
  const partnerFirmId = Object.keys(partner.firms)
    .filter((id) => s.firms[id] !== undefined && partner.firms[id]!.cash > 0)
    .sort((a, b) => partner.firms[b]!.cash - partner.firms[a]!.cash)[0]
    ?? Object.keys(partner.firms).sort()[0]!;
  const collides = s.firms[partnerFirmId] !== undefined;
  const homeFirm = s.firms[partnerFirmId];
  const partnerFirm = partner.firms[partnerFirmId]!;
  const differentEntities = !!homeFirm && homeFirm !== partnerFirm;
  check('an independently-minted partner firm id COLLIDES with a home firm id',
    collides && differentEntities,
    `id ${partnerFirmId}: home="${homeFirm?.name}" ($${(homeFirm?.cash ?? 0) / 100}), ` +
    `partner="${partnerFirm.name}" ($${partnerFirm.cash / 100}) — flat primitive would mis-resolve to the home holder`);

  // 3b — the FIX (region-unique ids): re-id the partner's firms with a distinct
  // namespace, as a shared-counter or namespaced factory would. Now the flat
  // account primitive correctly does NOT resolve them — which is precisely why
  // resolution must become region-scoped (read every town, not just towns.home).
  const reided: TownRecords = {
    ...partner,
    firms: Object.fromEntries(
      Object.entries(partner.firms).map(([id, f]) => [`pr_${id}`, { ...f, id: `pr_${id}` }]),
    ),
  };
  s.towns[PARTNER_ID] = reided;
  const reidedFirmId = Object.keys(reided.firms).sort()[0]!;
  const resolvableFlat = s.firms[reidedFirmId] !== undefined; // flat alias = towns.home only
  const livesInPartner = reided.firms[reidedFirmId] !== undefined;
  check('a region-unique partner firm id does NOT resolve through the flat account primitive',
    !resolvableFlat && livesInPartner,
    `flat-resolvable=${resolvableFlat}, in-partner=${livesInPartner} — resolution must go region-wide`);
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
