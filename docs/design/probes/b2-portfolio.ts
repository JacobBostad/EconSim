/**
 * B2-portfolio probe — Arc B2 (AI portfolio behavior) live baseline.
 *
 * Runs the CITY size preset (where the B2 market behaviors are active — they are
 * gated OFF the Village preset for the 300-day bit-identity contract) for 300
 * days × seeds 11/4/7 and reads the emergent equity market the AI now trades:
 *
 *   (a) does yield-based buying actually build portfolios, and do they stay
 *       within MAX_STAKE_PCT and the 100% public-float ledger (B1 review flag)?
 *   (b) portfolio P&L sanity — cost basis vs marked value, unrealized gain/loss;
 *   (c) NO runaway wash-trading — turnover (sum of |daily change in aggregate
 *       held| over the run ÷ mean aggregate held) must stay low; a churn loop
 *       would show turnover ≫ 1 as firms buy and dump the same blocks;
 *   (d) valuation median at day 300 — the beforeAfter drift the objective ladder
 *       would be re-pinned against IF it moved > 10%;
 *   (e) money conserved to the cent on every seed (share fees, dividends, distress
 *       liquidations all route through recordTransaction).
 *
 * The Village preset is untouched by B2 (every new path is gated on
 * sizePreset !== 'village'); its 300-day rng-state / serialize identity is the
 * hard contract the orchestrator re-runs, and is covered by the determinism and
 * golden-save suites. This probe only reads state — it mutates nothing.
 *
 * Runnable: `npx tsx docs/design/probes/b2-portfolio.ts` (DAYS / SEEDS env
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

interface Portfolio {
  holders: number; // firms holding >= 1 stake
  holdings: number; // distinct (holder, target) positions
  totalHeldPct: number; // sum of every firm's stakes (the aggregate float sum)
  maxTargetFloat: number; // largest aggregate float on any one target (<= 100?)
  maxStake: number; // largest single stake (<= MAX_STAKE_PCT?)
  costBasisCents: number;
  markCents: number; // holdings marked at counterparty marketCap
}

function portfolio(state: GameState): Portfolio {
  let holders = 0, holdings = 0, totalHeldPct = 0, maxStake = 0;
  let costBasisCents = 0, markCents = 0;
  const floatByTarget: Record<string, number> = {};
  for (const fid of Object.keys(state.firms).sort()) {
    const f = state.firms[fid]!;
    let holds = false;
    for (const tid of Object.keys(f.sharesHeld).sort()) {
      const pct = f.sharesHeld[tid] ?? 0;
      if (pct <= 0) continue;
      holds = true;
      holdings += 1;
      totalHeldPct += pct;
      maxStake = Math.max(maxStake, pct);
      floatByTarget[tid] = (floatByTarget[tid] ?? 0) + pct;
      costBasisCents += f.shareCostBasis[tid] ?? 0;
      markCents += Math.round((pct * marketCap(state, tid)) / 100);
    }
    if (holds) holders += 1;
  }
  const maxTargetFloat = Object.values(floatByTarget).reduce((m, v) => Math.max(m, v), 0);
  return { holders, holdings, totalHeldPct, maxTargetFloat, maxStake, costBasisCents, markCents };
}

function valuationMedian(state: GameState): number {
  const vals: number[] = [];
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai' && f.ownerType !== 'player') continue;
    vals.push(companyValuation(state, fid).valuation);
  }
  vals.sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid]! : Math.round((vals[mid - 1]! + vals[mid]!) / 2);
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const initialMoney = totalMoneySupply(state);

  let prevHeld = 0;
  let turnoverAccum = 0; // Σ |Δ aggregate held| across the run
  let heldSum = 0; // for mean aggregate held
  let heldSamples = 0;
  let worstConserved = 0;
  let maxFloatEver = 0;
  let maxStakeEver = 0;

  console.log(`\n=== seed ${seed} — City preset, ${DAYS} days ===`);
  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    const p = portfolio(state);
    turnoverAccum += Math.abs(p.totalHeldPct - prevHeld);
    prevHeld = p.totalHeldPct;
    heldSum += p.totalHeldPct;
    heldSamples += 1;
    maxFloatEver = Math.max(maxFloatEver, p.maxTargetFloat);
    maxStakeEver = Math.max(maxStakeEver, p.maxStake);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - initialMoney));

    if (day % 30 === 0 || day === DAYS) {
      console.log(
        `d${String(day).padStart(3)} holders ${p.holders} pos ${p.holdings} ` +
        `heldΣ ${p.totalHeldPct}% maxFloat ${p.maxTargetFloat}% maxStake ${p.maxStake}% | ` +
        `basis ${D(p.costBasisCents)} mark ${D(p.markCents)} uPnL ${D(p.markCents - p.costBasisCents)} | ` +
        `valMed ${D(valuationMedian(state))}`,
      );
    }
  }

  const meanHeld = heldSamples > 0 ? heldSum / heldSamples : 0;
  const turnoverRatio = meanHeld > 0 ? turnoverAccum / meanHeld : 0;
  const p = portfolio(state);
  console.log(JSON.stringify({
    seed,
    endPortfolio: {
      holders: p.holders,
      positions: p.holdings,
      aggregateHeldPct: p.totalHeldPct,
      costBasis: D(p.costBasisCents),
      markedValue: D(p.markCents),
      unrealizedPnL: D(p.markCents - p.costBasisCents),
    },
    caps: {
      maxSingleStakeEver: maxStakeEver, // must be <= MAX_STAKE_PCT (49)
      maxTargetFloatEver: maxFloatEver, // must be <= 100
      floatLedgerHeld: maxFloatEver <= 100,
      stakeCapHeld: maxStakeEver <= 49,
    },
    washTrading: {
      // turnover = churn ÷ average book. Buy-and-hold sits well under 1; a
      // wash-trading loop (buy, dump, rebuy) would blow this up.
      turnoverRatio: turnoverRatio.toFixed(2),
      runaway: turnoverRatio > 4,
    },
    valuationMedian: D(valuationMedian(state)),
    conservation: {
      worstDeltaCents: worstConserved,
      conservedToCent: worstConserved === 0,
    },
  }, null, 1));
}
