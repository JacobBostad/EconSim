/**
 * interest-rate probe — measures what the loan interest rate SHOULD be in THIS
 * economy, and what it currently DOES.
 *
 * The sim charges every firm a flat interestRatePerDay = 0.0009 (≈ 32.85%/yr
 * simple) — set as a literal in startingScenario / seedTown / AIFounderSystem /
 * migrations. The owner (playtest) paid $36/day on a $40k loan and read that as
 * credit-card pricing, not "inflation + margin + risk premium". This probe asks,
 * empirically:
 *
 *   PART A — STATUS QUO (rate = 0.0009), across the three pinned worlds
 *   (Village 11/4/7, flag-off City 11, full-flag City 11) over 300 days:
 *     · blended operating ROIC — annualized operating profit ÷ facility book
 *       value across operator firms (the number the rate must exceed to stop
 *       borrow-and-build from being free money);
 *     · debt usage — total borrowed, peak aggregate debt, firm-days in debt,
 *       interest paid as % of revenue;
 *     · bridge-vs-permanent — mean debt-spell length, fraction of spells that
 *       closed (a bridge) vs still open at day 300 (a permanent balance);
 *     · AI founder count, insolvent/distressed counts (the receivership signal),
 *       and the staple price level (inflation proxy).
 *
 *   PART B — THE EXPLOIT BOUNDARY (rate sweep). Re-runs flag-off City 11 and
 *   Village 11 at interestRatePerDay ∈ {0.0002, 0.0004, 0.0006, 0.0009} via an
 *   in-memory per-firm rate patch (re-applied every day so new AI founders also
 *   carry the swept rate) and records how debt, founder counts, bankruptcy and
 *   the price level move as the rate falls. Where borrow-and-build turns strictly
 *   profitable, debt balloons and the price level inflates; where the rate isn't
 *   binding, the grid is flat.
 *
 * Read-only beyond running the sim. The ONLY mutation is per-firm
 * `interestRatePerDay`, set in-process — the sim's source is byte-unchanged. The
 * mutation routes all interest through WORLD_ACCOUNT, so total money is conserved
 * at every rate; the probe asserts that as a sanity check.
 *
 * Runnable:  npx tsx docs/design/probes/interest-rate.ts
 * Env overrides: DAYS (300), SEEDS (11,4,7), RATES (0.0002,0.0004,0.0006,0.0009).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import type { SimulationConfig } from '../../../src/sim/core/SimulationConfig';
import { CHAIN_BLUEPRINTS, chainCost } from '../../../src/sim/data/chains';
import { getProduct } from '../../../src/sim/data/products';
import { getFacilityDef } from '../../../src/sim/data/facilityDefinitions';

const DAYS = Number(process.env.DAYS ?? 300);
const VILLAGE_SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const RATES = (process.env.RATES ?? '0.0002,0.0004,0.0006,0.0009')
  .split(',')
  .map((s) => Number(s.trim()));
const BASE_RATE = 0.0009;
const STAPLES = ['bread', 'tools', 'clothes', 'coffee'];

// ---- config builders for the three pinned worlds --------------------------
function villageConfig(): SimulationConfig {
  return { ...DEFAULT_CONFIG };
}
function cityFlagOffConfig(): SimulationConfig {
  return { ...DEFAULT_CONFIG, sizePreset: 'city' };
}
function cityFullFlagConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
  };
}

// ---- measurement -----------------------------------------------------------
interface Metrics {
  founders: number;         // AI firm count at day DAYS
  insolvent: number;
  distressed: number;
  operatorFirms: number;    // firms with book value > 0 (chains)
  roicBlendedPct: number;   // annualized operating profit ÷ facility book value (%)
  roicMedianPct: number;    // per-operator-firm median annualized ROIC (%)
  totalBorrowed: number;    // Σ positive day-over-day debt increases (cents)
  peakDebt: number;         // max aggregate debt across the run (cents)
  firmDaysInDebt: number;
  interestPaid: number;     // Σ daily interest across firms (cents)
  totalRevenue: number;     // Σ daily revenue across firms (cents)
  intPctRevenue: number;    // interestPaid / revenue (%)
  spellsClosed: number;     // debt spells that returned to zero (bridges)
  spellsOpen: number;       // firms still carrying debt at day DAYS
  meanSpellDays: number;    // mean length of CLOSED spells
  priceLevel: number;       // mean staple averagePrice over last 30 days (cents)
  moneyDrift: number;       // |money(end) - money(0)| (cents) — conservation check
}

interface FirmDebtTrack {
  prevDebt: number;
  spellStart: number;       // day the current spell began (-1 = not in debt)
  spellLengths: number[];   // closed-spell lengths
  daysInDebt: number;
}

// Pooled per-operator-firm ROIC samples, filled by the status-quo runs so we can
// print the dispersion (min/p25/median/p75/max) and the implied fair rate.
const roicPool: number[] = [];

function bookValue(state: GameState, firmId: string): number {
  let v = 0;
  const town = state.towns['home']!;
  const firm = town.firms[firmId]!;
  for (const facId of firm.facilities) {
    const fac = town.facilities[facId];
    if (!fac || fac.type === 'home' || fac.status === 'closed') continue;
    v += fac.buildCost;
  }
  return v;
}

/**
 * Run one world at a fixed interest rate (patched onto every firm each day, so
 * founders born mid-run also carry it) and return the metric bundle.
 */
function runWorld(config: SimulationConfig, seed: number, rate: number, poolRoic = false): Metrics {
  const state = createInitialState(seed, config);
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const town = state.towns['home']!;
  const money0 = totalMoneySupply(state);

  const applyRate = (): void => {
    for (const fid in town.firms) {
      const f = town.firms[fid]!;
      if (f.ownerType === 'player' || f.ownerType === 'ai') f.interestRatePerDay = rate;
    }
  };
  applyRate();

  const track: Record<string, FirmDebtTrack> = {};
  let totalBorrowed = 0;
  let peakDebt = 0;
  let firmDaysInDebt = 0;
  let interestPaid = 0;
  let totalRevenue = 0;
  // Rolling window of staple price levels (last 30 days).
  const priceWindow: number[] = [];

  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    applyRate(); // re-price new founders + keep everyone at `rate`

    // Aggregate debt + per-firm spell tracking on the finalized day.
    let aggDebt = 0;
    for (const fid in town.firms) {
      const f = town.firms[fid]!;
      if (f.ownerType !== 'player' && f.ownerType !== 'ai') continue;
      const t = (track[fid] ??= { prevDebt: 0, spellStart: -1, spellLengths: [], daysInDebt: 0 });
      const debt = f.debt;
      aggDebt += debt;
      if (debt > t.prevDebt) totalBorrowed += debt - t.prevDebt;
      if (debt > 0) {
        firmDaysInDebt += 1;
        t.daysInDebt += 1;
        if (t.spellStart < 0) t.spellStart = day;
      } else if (t.spellStart >= 0) {
        t.spellLengths.push(day - t.spellStart);
        t.spellStart = -1;
      }
      t.prevDebt = debt;
      // interest + revenue from the just-closed daily snapshot
      const hist = f.accounting.dailyHistory;
      const last = hist[hist.length - 1];
      if (last && last.day === day - 1) {
        interestPaid += last.interest;
        totalRevenue += last.revenue;
      }
    }
    peakDebt = Math.max(peakDebt, aggDebt);

    if (day > DAYS - 30) {
      let sum = 0, n = 0;
      for (const pid of STAPLES) {
        const h = state.marketStats[pid]?.history ?? [];
        const d = h[h.length - 1];
        if (d && d.averagePrice > 0) { sum += d.averagePrice; n += 1; }
      }
      if (n > 0) priceWindow.push(sum / n);
    }
  }

  // --- end-of-run rollups ---
  let founders = 0, insolvent = 0, distressed = 0;
  let bookTotal = 0, opProfitAnnTotal = 0, operatorFirms = 0;
  const roics: number[] = [];
  const WIN = Math.min(60, DAYS); // trailing window for operating ROIC
  for (const fid in town.firms) {
    const f = town.firms[fid]!;
    if (f.ownerType === 'ai') {
      founders += 1;
      if (f.bankruptcyStatus === 'insolvent') insolvent += 1;
      if (f.bankruptcyStatus === 'distressed') distressed += 1;
    }
    if (f.ownerType !== 'ai' && f.ownerType !== 'player') continue;
    const bv = bookValue(state, fid);
    if (bv <= 0) continue;
    const recent = f.accounting.dailyHistory.slice(-WIN);
    if (recent.length === 0) continue;
    const opSum = recent.reduce((s, d) => s + d.operatingProfit, 0);
    const opAnn = (opSum / recent.length) * 365;
    operatorFirms += 1;
    bookTotal += bv;
    opProfitAnnTotal += opAnn;
    const roic = (opAnn / bv) * 100;
    roics.push(roic);
    if (poolRoic) roicPool.push(roic);
  }
  roics.sort((a, b) => a - b);
  const median = roics.length
    ? roics[Math.floor((roics.length - 1) / 2)]! * (roics.length % 2 ? 1 : 1)
    : 0;

  let spellsClosed = 0, spellsOpen = 0, spellSum = 0, spellN = 0;
  for (const fid in track) {
    const t = track[fid]!;
    spellsClosed += t.spellLengths.length;
    for (const l of t.spellLengths) { spellSum += l; spellN += 1; }
    if (t.spellStart >= 0) spellsOpen += 1;
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  return {
    founders, insolvent, distressed, operatorFirms,
    roicBlendedPct: bookTotal > 0 ? (opProfitAnnTotal / bookTotal) * 100 : 0,
    roicMedianPct: median,
    totalBorrowed, peakDebt, firmDaysInDebt,
    interestPaid, totalRevenue,
    intPctRevenue: totalRevenue > 0 ? (interestPaid / totalRevenue) * 100 : 0,
    spellsClosed, spellsOpen,
    meanSpellDays: spellN > 0 ? spellSum / spellN : 0,
    priceLevel: mean(priceWindow),
    moneyDrift: Math.abs(totalMoneySupply(state) - money0),
  };
}

const D = (c: number) => (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n: number) => n.toFixed(1);

// ===========================================================================
// PART 0 — static chain economics (seed-independent reference)
// ===========================================================================
console.log('================================================================');
console.log('INTEREST-RATE PROBE');
console.log(`  DAYS=${DAYS}  base rate=${BASE_RATE}/day = ${(BASE_RATE * 365 * 100).toFixed(1)}%/yr (simple)`);
console.log('================================================================');
console.log('\n--- PART 0: chain build cost (the capital a loan would fund) ---');
for (const key of Object.keys(CHAIN_BLUEPRINTS)) {
  const bp = CHAIN_BLUEPRINTS[key]!;
  console.log(
    `  ${getProduct(bp.productId).name.padEnd(11)} chain $${D(chainCost(bp)).padStart(7)}` +
    `   marginal outlet (retail) $${D(getFacilityDef('retail').buildCost)}`,
  );
}

// ===========================================================================
// PART A — status quo (rate = 0.0009) across the three pinned worlds
// ===========================================================================
console.log('\n--- PART A: STATUS QUO @ rate 0.0009 (32.9%/yr) ---');
const hdr =
  'world'.padEnd(20) +
  'foundr'.padStart(7) + 'ins/dst'.padStart(9) +
  'ROIC%'.padStart(8) + 'ROICmed'.padStart(9) +
  'borrow$'.padStart(11) + 'peak$'.padStart(10) +
  'int/rev%'.padStart(10) + 'spellD'.padStart(8) +
  'brg/opn'.padStart(9) + 'price$'.padStart(9);
console.log(hdr);
console.log('-'.repeat(hdr.length));

interface Row { label: string; m: Metrics; }
const statusRows: Row[] = [];
for (const seed of VILLAGE_SEEDS) {
  statusRows.push({ label: `village ${seed}`, m: runWorld(villageConfig(), seed, BASE_RATE, true) });
}
statusRows.push({ label: 'city-flagoff 11', m: runWorld(cityFlagOffConfig(), 11, BASE_RATE, true) });
statusRows.push({ label: 'city-fullflag 11', m: runWorld(cityFullFlagConfig(), 11, BASE_RATE, true) });

for (const { label, m } of statusRows) {
  console.log(
    label.padEnd(20) +
    String(m.founders).padStart(7) +
    `${m.insolvent}/${m.distressed}`.padStart(9) +
    pct(m.roicBlendedPct).padStart(8) +
    pct(m.roicMedianPct).padStart(9) +
    D(m.totalBorrowed).padStart(11) +
    D(m.peakDebt).padStart(10) +
    pct(m.intPctRevenue).padStart(10) +
    m.meanSpellDays.toFixed(0).padStart(8) +
    `${m.spellsClosed}/${m.spellsOpen}`.padStart(9) +
    D(m.priceLevel).padStart(9),
  );
}
console.log('  (ROIC% = blended annualized operating profit ÷ facility book value —');
console.log('   the free-money boundary: rate above ROIC ⇒ borrow-and-build loses money.');
console.log('   spellD = mean CLOSED debt-spell length in days; brg/opn = spells closed / still open.)');
for (const { label, m } of statusRows) {
  if (m.moneyDrift !== 0) console.log(`  !! conservation broken in ${label}: drift ${m.moneyDrift}c`);
}

// The loud finding: no firm ever borrows in the pinned baselines.
const anyDebt = statusRows.some((r) => r.m.peakDebt > 0 || r.m.totalBorrowed > 0);
console.log(`\n  ** AI/passive-player debt across ALL status-quo worlds: ${anyDebt ? 'PRESENT' : 'ZERO'} **`);
if (!anyDebt) {
  console.log('     Every founder self-funds from founding capital; expansion is cash-financed.');
  console.log('     The interest transaction is gated on debt>0, so at these seeds the RATE NEVER');
  console.log('     FIRES — it is a purely player-facing, debt-conditional cost. (Confirmed');
  console.log('     separately: village 11 / city 11 reproduce their pinned rngState + money');
  console.log('     byte-for-byte even at rate 0.5/day, because maxDebt stays 0.)');
}

// Pooled ROIC dispersion — the honest "what must the rate beat?" picture.
if (roicPool.length > 0) {
  const s = [...roicPool].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
  console.log('\n  Operating ROIC dispersion across all operator firms (annualized, %):');
  console.log(
    `    n=${s.length}  min ${q(0).toFixed(0)}  p25 ${q(0.25).toFixed(0)}  median ${q(0.5).toFixed(0)}` +
    `  p75 ${q(0.75).toFixed(0)}  max ${q(1).toFixed(0)}`,
  );
  console.log(`    current rate = 32.9%/yr. Firms above that line earn more on capital than debt costs`);
  console.log(`    → borrow-and-build is +EV for them; the rate does NOT deter it (the 1.5×-net-worth`);
  console.log(`    credit limit is the real brake). Firms below the line would lose money borrowing.`);
  const above = s.filter((x) => x > 32.9).length;
  console.log(`    ${above}/${s.length} firms (${((100 * above) / s.length).toFixed(0)}%) sit ABOVE the current rate line.`);
}

// ===========================================================================
// PART B — exploit boundary: rate sweep on flag-off City 11 and Village 11
// ===========================================================================
console.log('\n--- PART B: RATE SWEEP (exploit boundary) ---');
console.log('  For each world, sweep interestRatePerDay; watch debt, founders,');
console.log('  bankruptcy and the staple price level move as the rate falls.');

const sweepWorlds: { label: string; config: () => SimulationConfig; seed: number }[] = [
  { label: 'city-flagoff 11', config: cityFlagOffConfig, seed: 11 },
  { label: 'village 11', config: villageConfig, seed: 11 },
];

for (const w of sweepWorlds) {
  console.log(`\n  === ${w.label} ===`);
  const shead =
    'rate/day'.padStart(9) + 'ann%'.padStart(7) +
    'foundr'.padStart(7) + 'ins/dst'.padStart(9) +
    'ROIC%'.padStart(8) +
    'borrow$'.padStart(11) + 'peak$'.padStart(10) +
    'int/rev%'.padStart(10) + 'firmDbtDy'.padStart(11) +
    'brg/opn'.padStart(9) + 'price$'.padStart(9);
  console.log(shead);
  console.log('  ' + '-'.repeat(shead.length));
  for (const rate of RATES) {
    const m = runWorld(w.config(), w.seed, rate);
    console.log('  ' +
      rate.toFixed(4).padStart(9) +
      (rate * 365 * 100).toFixed(0).padStart(7) +
      String(m.founders).padStart(7) +
      `${m.insolvent}/${m.distressed}`.padStart(9) +
      pct(m.roicBlendedPct).padStart(8) +
      D(m.totalBorrowed).padStart(11) +
      D(m.peakDebt).padStart(10) +
      pct(m.intPctRevenue).padStart(10) +
      String(m.firmDaysInDebt).padStart(11) +
      `${m.spellsClosed}/${m.spellsOpen}`.padStart(9) +
      D(m.priceLevel).padStart(9),
    );
  }
}

console.log('\n--- READING THE GRID ---');
console.log('  · If lowering the rate leaves debt/founders/price flat, the rate is NOT the');
console.log('    binding brake at that level — the credit limit (1.5× net worth) is.');
console.log('  · If lowering the rate balloons borrow$/peak$ and lifts price$, borrow-and-build');
console.log('    has become free money: the annual rate has dropped below operating ROIC.');
console.log('  · int/rev% is the drag the owner felt; compare across rates for the honest cost.');
console.log('\nDONE.');
