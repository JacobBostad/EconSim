/**
 * ai/investor.ts — the "investor" firm archetype (Arc D3, design HD5): a pure
 * holding company that owns no production and runs one loop — its equity book.
 *
 * It rides the Arc B machinery the operator already proved, sized for a holdco:
 *  - yield-based stake buying (B2's maybeBuyStakeCity logic, more aggressive —
 *    a lower idle-cash floor, bigger blocks, a higher stake cap laddering toward
 *    the control block), harvesting dividends the DividendSystem pays holders;
 *  - opportunistic distress buying (B1 rescue consolidation at the distressed
 *    discount, which respects the 40% control-block veto through
 *    performAcquisition's acquisitionBlocker exactly as the player's bid does);
 *  - deleveraging when flush (manageDebt) — a holdco carries little debt, but the
 *    rung is here for honesty under drawdown.
 * Every trade routes through tradeShares, so MAX_STAKE_PCT, the 40% hostile
 * blocker, the 100% public-float ledger, the 3% fee and price impact all bind a
 * holdco identically to the player and the operator field. Distress selling (the
 * exit) lives in BankruptcySystem.liquidatePortfolio, shared with the operator.
 *
 * CITY-SCALE ONLY. No preset founds an investor except the city-gated founder
 * row (AIFounderSystem), and the SAVE_VERSION 2 migration normalizes every old
 * firm to 'operator' — so this loop is structurally unreachable in the Village
 * bit-identity baseline AND in the pinned Metropolis founder soak. Its buy path
 * is deterministic (sorted scan, no shared-rng draw); the only rng it can touch
 * is the rescue cadence, and that short-circuits below the $60k floor a fresh
 * holdco never reaches — so a young holdco perturbs the city stream through cash
 * coupling alone, never by advancing the draw stream itself.
 */

import type { SimContext } from '../../core/GameState';
import { emitEvent } from '../../core/GameState';
import { townOf } from '../../core/Town';
import { MAX_STAKE_PCT, DIVIDEND_PAYOUT_RATIO } from '../../data/constants';
import { marketCap, operatingValuationOf } from '../../selectors/companySelectors';
import { tradeShares, sharePricePerPct } from '../../core/Shares';
import { smoothedProfitBase } from '../DividendSystem';
import { getPersonality } from '../../data/personalities';
import { operatingProfit } from '../../entities/Accounting';
import { maybeRescueAcquisition, manageDebt } from './finance';
import type { DigestBuffer } from './digest';

// A holdco keeps far less idle cash than an operator's $35k buffer — its
// business IS the book, not working capital. Pinned by the d3-investor probe:
// city holdcos stay solvent on dividend + realized P&L at this floor across
// seeds 11/4/7, and liquidate before insolvency when a drawdown bites.
const HOLDCO_CASH_FLOOR = 15000_00;
// Neutral stake cap, scaled by persona appetite and clamped to MAX_STAKE_PCT —
// higher than the operator's 25 base (finance.ts AI_CITY_STAKE_BASE_CAP): a
// holdco ladders toward the 40% control block / 49% partial cap rather than
// dabbling. An expansionist (appetite 1.6) saturates the cap; an exporter
// (0.6) stops near 24%.
const HOLDCO_STAKE_BASE_CAP = 40;
// Bigger blocks than the operator's 5% — a holdco moves size when it likes a
// yield. tradeShares still clamps each block to the cap and the float.
const HOLDCO_BLOCK = 10;
// Buy anything yielding above trading noise — same floor as the operator path's
// AI_CITY_YIELD_MIN; the holdco's edge is sizing and persistence, not a pickier
// bar.
const HOLDCO_YIELD_MIN = 0.0005;

/**
 * Deploy surplus cash into the highest-yielding rival, holdco-sized. Yield is
 * the target's smoothed dividend base over its marketCap — exactly the base the
 * DividendSystem pays from — among healthy, actually-earning, operating-solvent
 * rivals we can still add to. Deterministic: a sorted scan with a strict-greater
 * compare (lowest firm id wins a tie), no shared-rng draw, so the holdco never
 * advances the city draw stream on its buys — only its settled cash does.
 */
function maybeBuyStakeHoldco(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (firm.cash < HOLDCO_CASH_FLOOR) return;

  const appetite = getPersonality(firm.personalityId).stakeAppetite;
  const cap = Math.min(MAX_STAKE_PCT, Math.round(HOLDCO_STAKE_BASE_CAP * appetite));

  let target: string | null = null;
  let bestYield = HOLDCO_YIELD_MIN;
  for (const fid of Object.keys(town.firms).sort()) {
    if (fid === firmId) continue;
    const other = town.firms[fid]!;
    if (other.ownerType !== 'player' && other.ownerType !== 'ai') continue;
    if (other.bankruptcyStatus !== 'healthy') continue; // never ladder into trouble
    if ((firm.sharesHeld[fid] ?? 0) >= cap) continue;
    const base = smoothedProfitBase(other);
    if (base <= 0) continue;
    if (operatingValuationOf(state, fid) <= 0) continue;
    const mcap = marketCap(state, fid);
    if (mcap <= 0) continue;
    const yieldSignal = base / mcap;
    if (yieldSignal > bestYield) {
      bestYield = yieldSignal;
      target = fid;
    }
  }
  if (!target) return;

  const want = Math.min(HOLDCO_BLOCK, cap - (firm.sharesHeld[target] ?? 0));
  if (want <= 0) return;
  // Fees + fill impact land on top of the quote — budget with headroom, and
  // keep the holdco's own solvency floor intact after the buy.
  const cost = Math.round(want * sharePricePerPct(state, target) * 1.05);
  if (firm.cash - cost < HOLDCO_CASH_FLOOR) return;

  if (tradeShares(state, firmId, target, want)) {
    const yieldPct = (bestYield * DIVIDEND_PAYOUT_RATIO * 365 * 100).toFixed(0);
    emitEvent(state, 'info', 'ai',
      `${firm.name} built its ${firm.sharesHeld[target]}% position in ${town.firms[target]!.name} to harvest dividends (~${yieldPct}%/yr).`,
      target);
  }
}

/**
 * Run one 'investor' (holdco) firm's daily loop. No production to price or
 * staff — just the book: deleverage when flush, ladder into yield, and absorb a
 * dying rival at the distressed discount when rich enough (the rescue path only
 * touches the shared rng once cash clears its $60k floor). The loss streak is
 * tracked off operating profit like the operator, so the distress ladder in
 * BankruptcySystem reads a holdco the same way.
 */
export function runInvestorBehavior(
  ctx: SimContext,
  firmId: string,
  _digest: DigestBuffer | undefined,
): void {
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  const firm = town.firms[firmId]!;
  if (firm.bankruptcyStatus === 'healthy') {
    manageDebt(ctx, firmId);
    maybeBuyStakeHoldco(ctx, firmId);
    if (maybeRescueAcquisition(ctx, firmId)) return; // firm map changed
  }
  // Track loss streak off operating profit (dividend income is netProfit, not
  // operating — so a holdco living on dividends still reads flat-operating here,
  // which is correct: it has no operations to lose money on).
  const op = operatingProfit(firm.accounting.today);
  firm.strategy.lossStreak = op < 0 ? firm.strategy.lossStreak + 1 : 0;
}
