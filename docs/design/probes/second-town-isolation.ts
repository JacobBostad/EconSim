/**
 * second-town-isolation — the de-risking probe for region.md step 4 (a second
 * genuinely simulated town). The step-4 equivalent of A3's shadow-parity spike.
 *
 * As of step-4 slice 1 the town FACTORY ships (`seedTown(region, townId, spec)`
 * in src/sim/data/seedTown.ts) and `regionEnabled` seeds an inert `port_rosa`
 * partner from `createInitialState`. This probe was updated to use the REAL
 * factory (it subsumed the probe's earlier hand-rolled `buildPartnerRecords`),
 * so it now VERIFIES against the shipped code the three properties it once
 * measured against a stand-in:
 *
 *  (1) ISOLATION — a flag-ON City home is byte-identical to flag-OFF. The
 *      factory-seeded partner mints off the region's SHARED idCounters with
 *      TOWN-NAMESPACED prefixes (so home's own `firm`/`fac` counters never
 *      advance) and draws from a LOCAL rng (so the shared rng stream is
 *      untouched); in slice 1 no system ticks the partner. "Leakage" = any home
 *      read that saw the partner (home rngState / serialized `towns.home` drifts)
 *      or any home write that mutated the partner (its serialized records change
 *      across a home-only run). We detect both by diffing a flag-off control run
 *      against a flag-on treatment run, byte for byte.
 *
 *  (2) THE MONEY DEBT, PAID — this probe originally measured the flat money
 *      primitive (`totalMoneySupply` + the account-resolution trio) silently
 *      omitting the partner's holder cash (the region-money debt slice 2 was
 *      designed against). Slice 2 landed: the primitive iterates every town in
 *      sorted order, so the check flipped — it now asserts the primitive EQUALS
 *      this probe's independent region-wide reference with zero omission.
 *
 *  (3) THE ID-COLLISION HAZARD, AVOIDED — the finding that constrained the
 *      factory: a partner minted from a SEPARATE createInitialState gets its OWN
 *      idCounters from zero, so its `firm_3` collides with home's `firm_3`, and
 *      the flat primitive would mis-resolve it to the WRONG (home) holder. The
 *      shipped factory avoids this by minting off the region's shared counters
 *      (town-namespaced), so the partner's ids are region-unique — they collide
 *      with nothing in home and correctly fail to resolve through the flat
 *      primitive, which is exactly why resolution must go region-wide (slice 2).
 *      We demonstrate BOTH: the hazard a naive fresh-counter partner would hit,
 *      and that the factory's partner is free of it.
 *
 * Note on scope: this probe does NOT tick the partner town — that needs the
 * dispatch change a later slice introduces (a TownScheduler). It attaches an
 * INERT partner (the shipped factory's records) to prove the seam isolates home
 * and to quantify the money debt.
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
import { HOME_TOWN_ID, type TownRecords } from '../../../src/sim/core/Town';
import { PARTNER_TOWN_ID } from '../../../src/sim/data/seedTown';
import { createHash } from 'crypto';

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

/** City config with the region flag ON — createInitialState seeds the partner. */
function regionConfig(): SimulationConfig {
  return { ...cityConfig(), regionEnabled: true };
}

/** Stable hash of one town's record families (order-independent of `state`). */
function hashTown(records: TownRecords): string {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0, 16);
}

/**
 * The region-aware money sum step 4 (slice 2) makes `totalMoneySupply` become:
 * every town's firms + citizens + cohorts, plus the one shared world account.
 * Defined HERE (not in sim code) so the probe can contrast it with today's flat
 * primitive; it is the reference the slice-2 test pins against.
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

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('=== second-town-isolation probe (region.md step 4 de-risk) ===\n');

// ---------------------------------------------------------------------------
// (0) FLAG-OFF ANCHOR — the pinned Village seed-11 300-day rngState still holds.
// With no partner attached, today's default game IS the flag-off case. This
// reproduces the house-rule pin (village 11 → 3274842624) as the anchor.
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
// (1) ISOLATION — a flag-ON City home is byte-identical to flag-OFF over 30
// days, and the factory-seeded partner is untouched by the home-only tick loop.
// ---------------------------------------------------------------------------
console.log('\n(1) Isolation — flag-on home byte-identical to flag-off (City, seed 11, 30d)');
const DAYS = 30;
{
  // Control: flag off — a one-town region, no partner.
  const ctrl = createInitialState(11, cityConfig());
  const ctrlSim = new Simulation(ctrl);
  ctrlSim.dispatch({ type: 'RESUME' });
  ctrlSim.run(ticksPerDay(ctrl.config) * DAYS);
  const ctrlRng = ctrl.rngState;
  const ctrlHome = hashTown(ctrl.towns[HOME_TOWN_ID]!);
  // Home-scoped (one-town control: identical to totalMoneySupply, but stated
  // in the same home+world terms the flag-on comparison below must use).
  const ctrlMoney = townCash(ctrl.towns[HOME_TOWN_ID]!) + ctrl.worldCash;

  // Treatment: flag ON — createInitialState seeds the inert partner (seedTown).
  const trt = createInitialState(11, regionConfig());
  const partnerBefore = hashTown(trt.towns[PARTNER_TOWN_ID]!);
  const trtSim = new Simulation(trt);
  trtSim.dispatch({ type: 'RESUME' });
  trtSim.run(ticksPerDay(trt.config) * DAYS);
  const partnerAfter = hashTown(trt.towns[PARTNER_TOWN_ID]!);

  check('partner town materializes in state (flag on)', !!trt.towns[PARTNER_TOWN_ID]);
  check('home rngState identical with/without partner (no read-leak into rng)',
    trt.rngState === ctrlRng, `${trt.rngState} vs ${ctrlRng}`);
  check('serialized towns.home identical with/without partner (no read-leak)',
    hashTown(trt.towns[HOME_TOWN_ID]!) === ctrlHome,
    `${hashTown(trt.towns[HOME_TOWN_ID]!)} vs ${ctrlHome}`);
  check('serialized towns.port_rosa unchanged across home-only run (no write-leak)',
    partnerAfter === partnerBefore, `${partnerAfter} vs ${partnerBefore}`);
  // Slice 2 made totalMoneySupply region-wide, so the flag-on sum rightly
  // includes the partner's cash and is NOT comparable across the two runs.
  // The isolation property is HOME-scoped: home's holder cash + the world
  // account must match with and without the partner attached.
  const trtHomeMoney = townCash(trt.towns[HOME_TOWN_ID]!) + trt.worldCash;
  check('home-scoped money (home holders + world) identical with/without partner',
    trtHomeMoney === ctrlMoney, `${trtHomeMoney} vs ${ctrlMoney}`);
}

// ---------------------------------------------------------------------------
// (2) THE MONEY DEBT, PAID — slice 2 made the primitive region-wide; assert a
// region-aware sum recovers it. This is the account-resolution + totalMoneySupply
// change step 4 slice 2 § "The seam's debts" specifies.
// ---------------------------------------------------------------------------
console.log('\n(2) Money debt — PAID (slice 2): totalMoneySupply is region-wide');
{
  const s = createInitialState(11, regionConfig());
  const partner = s.towns[PARTNER_TOWN_ID]!;

  // Slice 2 flipped this check's invariant: totalMoneySupply once read only
  // towns.home (this probe measured the partner's cash silently omitted — the
  // debt that justified the slice); it now iterates every town, so it must
  // EQUAL the probe's independent region-wide reference with zero omission,
  // and the partner's holder cash must be non-trivially inside the sum.
  const primitive = totalMoneySupply(s);     // slice 2: every town + world
  const region = regionMoneySupply(s);       // this probe's independent reference
  const partnerHolders = townCash(partner);

  check('totalMoneySupply equals the independent region-wide reference (debt paid)',
    primitive === region, `primitive ${primitive} vs reference ${region}`);
  check('the partner town\'s holder cash is real and inside the sum',
    partnerHolders > 0 && primitive >= partnerHolders,
    `partner holds ${partnerHolders} cents`);

  console.log(`     [measured] totalMoneySupply (region-wide) = ${primitive} cents`);
  console.log(`     [measured] independent region reference   = ${region} cents`);
  console.log(`     [measured] partner town holder cash inside the sum = ${partnerHolders} cents`);
}

// ---------------------------------------------------------------------------
// (3) THE ID-COLLISION HAZARD, AVOIDED — the factory mints off the region's
// SHARED idCounters (town-namespaced), so the partner's ids are region-unique.
// We show the hazard a naive fresh-counter partner WOULD hit (its firm_3
// collides with home's firm_3), and that the shipped factory is free of it.
// ---------------------------------------------------------------------------
console.log('\n(3) Id-collision hazard, avoided — the factory mints region-unique ids');
{
  // 3a — the HAZARD: a partner lifted from a SEPARATE createInitialState (its own
  // counters from zero) collides with home. This is why the factory must share
  // the region's counters rather than start a fresh set.
  const home = createInitialState(11, cityConfig());
  const separate = createInitialState(4, cityConfig()); // independent counters
  const separateHome = separate.towns[HOME_TOWN_ID]!;
  const collidingId = Object.keys(separateHome.firms)
    .filter((id) => home.towns[HOME_TOWN_ID]!.firms[id] !== undefined)
    .sort()[0];
  check('a naive fresh-counter partner firm id COLLIDES with a home firm id (the hazard)',
    collidingId !== undefined,
    collidingId ? `id ${collidingId}: home="${home.towns[HOME_TOWN_ID]!.firms[collidingId]!.name}", ` +
      `separate="${separateHome.firms[collidingId]!.name}" — the flat primitive would mis-resolve` : '');

  // 3b — the FIX: the shipped factory-seeded partner. Its firm ids are
  // region-unique (town-namespaced off the SHARED counters), so they collide
  // with NOTHING in home and correctly do NOT resolve through the flat account
  // primitive — which is exactly why resolution must go region-wide (slice 2).
  const s = createInitialState(11, regionConfig());
  const partner = s.towns[PARTNER_TOWN_ID]!;
  const partnerFirmIds = Object.keys(partner.firms);
  const anyCollision = partnerFirmIds.some((id) => s.firms[id] !== undefined);
  check('the factory partner has firms (a real second economy)', partnerFirmIds.length > 0,
    `${partnerFirmIds.length} firms`);
  check('the factory partner firm ids are region-unique (collide with nothing in home)',
    !anyCollision, partnerFirmIds.length > 0 ? `e.g. ${partnerFirmIds.sort()[0]}` : '');
  const sampleId = partnerFirmIds.sort()[0];
  const resolvableFlat = sampleId !== undefined && s.firms[sampleId] !== undefined;
  const livesInPartner = sampleId !== undefined && partner.firms[sampleId] !== undefined;
  check('a region-unique partner firm id does NOT resolve through the flat account primitive',
    !resolvableFlat && livesInPartner,
    `flat-resolvable=${resolvableFlat}, in-partner=${livesInPartner} — resolution must go region-wide`);
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
