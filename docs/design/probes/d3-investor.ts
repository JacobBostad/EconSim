/**
 * D3-investor probe — Arc D3 (investor holdco archetype) live baseline.
 *
 * Runs the CITY size preset (the only scale that founds an investor — the
 * archetype is gated OFF Village for the 300-day bit-identity contract and OFF
 * Metropolis so its pinned founder soak is untouched) for 300 days × seeds
 * 11/4/7 and reads the holdcos the founder now spins up:
 *
 *   (a) do investor firms actually get founded, and how many / when?
 *   (b) are they SOLVENT at day 300 on dividend income + realized/unrealized
 *       P&L (a holdco owns no production — its only income is the book)?
 *   (c) portfolio turnover sane (no wash-trading) — Σ|Δ held| ÷ mean held stays
 *       low; a churn loop would blow it past ~4;
 *   (d) every cap holds — each stake ≤ MAX_STAKE_PCT (49), aggregate float on
 *       any target ≤ 100% (the B2 float ledger), applied to the WHOLE field;
 *   (e) beforeAfter — investor count, portfolio P&L (mark − basis + dividends),
 *       dividend income vs share/rescue costs at day 300;
 *   (f) money conserved to the cent on every seed.
 *
 * This probe only READS state — it mutates nothing.
 *
 * Runnable: `npx tsx docs/design/probes/d3-investor.ts` (DAYS / SEEDS env
 * override the 300-day length and the seed list).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import { marketCap, companyValuation } from '../../../src/sim/selectors/companySelectors';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const CENTS = 100;
const D = (cents: number): string => (cents / CENTS).toFixed(2);

interface InvestorRead {
  firms: number;
  insolvent: number;
  cashCents: number;
  positions: number;
  totalHeldPct: number;
  maxStake: number;
  costBasisCents: number;
  markCents: number;
  dividendInCents: number; // lifetime dividend income
  shareBuyCents: number; // lifetime share purchases (incl. fees)
  shareSellCents: number; // lifetime share sale proceeds
  valuationCents: number; // scoreboard valuation of the holdcos
}

function investors(state: GameState): InvestorRead {
  const r: InvestorRead = {
    firms: 0, insolvent: 0, cashCents: 0, positions: 0, totalHeldPct: 0, maxStake: 0,
    costBasisCents: 0, markCents: 0, dividendInCents: 0, shareBuyCents: 0, shareSellCents: 0,
    valuationCents: 0,
  };
  for (const fid of Object.keys(state.firms).sort()) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai' || f.strategy.archetype !== 'investor') continue;
    r.firms += 1;
    if (f.bankruptcyStatus === 'insolvent') r.insolvent += 1;
    r.cashCents += f.cash;
    for (const tid of Object.keys(f.sharesHeld).sort()) {
      const pct = f.sharesHeld[tid] ?? 0;
      if (pct <= 0) continue;
      r.positions += 1;
      r.totalHeldPct += pct;
      r.maxStake = Math.max(r.maxStake, pct);
      r.costBasisCents += f.shareCostBasis[tid] ?? 0;
      r.markCents += Math.round((pct * marketCap(state, tid)) / 100);
    }
    const life = f.accounting.lifetime;
    r.dividendInCents += life.dividendIn ?? 0;
    r.shareBuyCents += life.shareBuy ?? 0;
    r.shareSellCents += life.shareSell ?? 0;
    r.valuationCents += companyValuation(state, fid).valuation;
  }
  return r;
}

/** Aggregate float on any target across the WHOLE field (cap check ≤ 100). */
function maxAggregateFloat(state: GameState): number {
  const byTarget: Record<string, number> = {};
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    for (const tid in f.sharesHeld) byTarget[tid] = (byTarget[tid] ?? 0) + (f.sharesHeld[tid] ?? 0);
  }
  return Object.values(byTarget).reduce((m, v) => Math.max(m, v), 0);
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', investorsEnabled: true });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const initialMoney = totalMoneySupply(state);

  let prevHeld = 0, turnoverAccum = 0, heldSum = 0, heldSamples = 0;
  let worstConserved = 0, maxFloatEver = 0, maxStakeEver = 0;
  const foundedDays: number[] = [];
  let prevFirms = 0;

  console.log(`\n=== seed ${seed} — City preset, ${DAYS} days ===`);
  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    const r = investors(state);
    if (r.firms > prevFirms) foundedDays.push(day);
    prevFirms = r.firms;
    turnoverAccum += Math.abs(r.totalHeldPct - prevHeld);
    prevHeld = r.totalHeldPct;
    if (r.firms > 0) { heldSum += r.totalHeldPct; heldSamples += 1; }
    maxFloatEver = Math.max(maxFloatEver, maxAggregateFloat(state));
    maxStakeEver = Math.max(maxStakeEver, r.maxStake);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - initialMoney));

    if (day % 50 === 0 || day === DAYS) {
      console.log(
        `d${String(day).padStart(3)} inv ${r.firms} (insolv ${r.insolvent}) cash ${D(r.cashCents)} ` +
        `pos ${r.positions} heldΣ ${r.totalHeldPct}% maxStake ${r.maxStake}% | ` +
        `basis ${D(r.costBasisCents)} mark ${D(r.markCents)} uPnL ${D(r.markCents - r.costBasisCents)} ` +
        `divIn ${D(r.dividendInCents)} val ${D(r.valuationCents)}`,
      );
    }
  }

  const r = investors(state);
  const meanHeld = heldSamples > 0 ? heldSum / heldSamples : 0;
  const turnoverRatio = meanHeld > 0 ? turnoverAccum / meanHeld : 0;
  // Portfolio P&L = unrealized (mark − basis) + lifetime dividend income. Share
  // fees + rescue outlays are embedded in shareBuy (all-in cost basis).
  const portfolioPnL = (r.markCents - r.costBasisCents) + r.dividendInCents;
  console.log(JSON.stringify({
    seed,
    investors: {
      count: r.firms,
      insolvent: r.insolvent,
      foundedOnDays: foundedDays,
      cash: D(r.cashCents),
      positions: r.positions,
      aggregateHeldPct: r.totalHeldPct,
    },
    pnl: {
      costBasis: D(r.costBasisCents),
      markedValue: D(r.markCents),
      unrealizedPnL: D(r.markCents - r.costBasisCents),
      dividendIncome: D(r.dividendInCents),
      shareBuyOutlay: D(r.shareBuyCents),
      shareSellProceeds: D(r.shareSellCents),
      portfolioPnL: D(portfolioPnL),
      scoreboardValuation: D(r.valuationCents),
    },
    caps: {
      maxSingleStakeEver: maxStakeEver,
      maxTargetFloatEver: maxFloatEver,
      stakeCapHeld: maxStakeEver <= 49,
      floatLedgerHeld: maxFloatEver <= 100,
    },
    washTrading: { turnoverRatio: turnoverRatio.toFixed(2), runaway: turnoverRatio > 4 },
    conservation: { worstDeltaCents: worstConserved, conservedToCent: worstConserved === 0 },
  }, null, 1));
}
