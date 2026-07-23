/**
 * DividendSystem — distributes a share of profits to shareholders.
 *
 * Runs at the day boundary BEFORE AccountingSystem resets the day's books.
 * Each firm pays DIVIDEND_PAYOUT_RATIO of its smoothed profit — the 7-day
 * average of positive daily net profit (the same base the dashboard's yield
 * estimate shows, and far less noisy than any single day). Holders of its
 * shares receive their percentage; the remainder (the public float) leaves to
 * the world account — an intentional sink that balances the world-account
 * inflows from share sales.
 *
 * Bookkeeping is honest on both sides of every payment: the payer books
 * dividendOut (a distribution, never an expense — it must not shrink the
 * profit it is computed from), the receiving firm books dividendIn, which IS
 * part of net profit — so the valuation's earnings multiple capitalizes
 * investment income and a holding company is finally worth its portfolio.
 *
 * Determinism: pools are snapshotted for every payer BEFORE any payout
 * settles, and firms are iterated in sorted-id order — the result cannot
 * depend on object-key order or on dividends received earlier the same tick.
 */

import type { SimContext } from '../core/GameState';
import type { Firm } from '../entities/Firm';
import { formatMoney } from '../../utils/formatMoney';
import { recordTransaction, emitEvent } from '../core/GameState';
import { townOf } from '../core/Town';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { netProfit } from '../entities/Accounting';
import { DIVIDEND_PAYOUT_RATIO } from '../data/constants';
import { getPersonality } from '../data/personalities';

/**
 * The smoothed profit a firm's dividend (and any yield read on it) is sized
 * from: the 7-day average of positive daily net profit, falling back to today
 * before any history exists. Exported so the AI's yield-based buying scores a
 * target off exactly the base the dividend is actually paid from.
 */
export function smoothedProfitBase(firm: Firm): number {
  const recent = firm.accounting.dailyHistory.slice(-7);
  return recent.length
    ? recent.reduce((s, d) => s + Math.max(0, d.netProfit), 0) / recent.length
    : Math.max(0, netProfit(firm.accounting.today));
}

export function runDividendSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const town = townOf(state, ctx.townId);

  // City-scale only: persona payout stance (Arc B2). The pool that sizes the
  // PUBLIC-FLOAT drain stays the flat DIVIDEND_PAYOUT_RATIO at every scale — so
  // the town's dividend sink is unchanged and the A3 crowd/tier calibration is
  // undisturbed. The persona multiplier tilts ONLY the firm-to-firm payments to
  // actual shareholders (a growth persona retains what it would owe its
  // holders; an income persona tops them up). Village runs mult = 1, and
  // round(neutralInteger * 1) === neutralInteger with the min() never binding,
  // so the Village payout is byte-identical to the pre-B2 code.
  const cityScale = state.config.sizePreset !== 'village';

  const firmIds = Object.keys(town.firms).sort();

  // Snapshot every pool first: smoothed profit base, capped by cash on hand.
  const pools = new Map<string, number>();
  for (const fid of firmIds) {
    const payer = town.firms[fid]!;
    if (payer.ownerType !== 'player' && payer.ownerType !== 'ai') continue;
    if (payer.cash <= 0) continue;
    const base = smoothedProfitBase(payer);
    const pool = Math.min(Math.round(base * DIVIDEND_PAYOUT_RATIO), payer.cash);
    if (pool > 0) pools.set(fid, pool);
  }

  for (const fid of firmIds) {
    const pool = pools.get(fid);
    if (!pool) continue;
    const payer = town.firms[fid]!;
    const mult = cityScale ? getPersonality(payer.personalityId).dividendMult : 1;

    let remaining = payer.cash; // never distribute more than cash on hand
    let neutralToHolders = 0; // the un-tilted holder share, sizing the drain
    for (const hid of firmIds) {
      if (hid === fid) continue;
      const holder = town.firms[hid]!;
      const pct = holder.sharesHeld[fid] ?? 0;
      if (pct <= 0) continue;
      const neutral = Math.floor((pool * pct) / 100);
      neutralToHolders += neutral;
      const amount = Math.min(remaining, Math.round(neutral * mult));
      if (amount <= 0) continue;
      remaining -= amount;
      recordTransaction(state, {
        from: firmAccount(fid),
        to: firmAccount(hid),
        amount,
        firmId: fid,
        category: 'dividendOut',
        counterparty: { firmId: hid, category: 'dividendIn' },
        note: `Dividend from ${payer.name} (${pct}%)`,
      });
      if (hid === state.playerFirmId) {
        emitEvent(state, 'success', 'finance', `Received ${formatMoney(amount)} dividend from ${payer.name} (${pct}% stake).`, fid);
      }
    }
    // Public float's share — the NEUTRAL remainder, independent of persona — is
    // the intentional world-account sink and stays exactly as pre-B2.
    const publicShare = Math.min(remaining, pool - neutralToHolders);
    if (publicShare > 0) {
      recordTransaction(state, {
        from: firmAccount(fid),
        to: WORLD_ACCOUNT,
        amount: publicShare,
        firmId: fid,
        category: 'dividendOut',
        note: `Dividend to public shareholders of ${payer.name}`,
      });
    }
  }
}
