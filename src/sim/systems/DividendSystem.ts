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
import { formatMoney } from '../../utils/formatMoney';
import { recordTransaction, emitEvent } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { netProfit } from '../entities/Accounting';
import { DIVIDEND_PAYOUT_RATIO } from '../data/constants';

export function runDividendSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;

  const firmIds = Object.keys(state.firms).sort();

  // Snapshot every pool first: smoothed profit base, capped by cash on hand.
  const pools = new Map<string, number>();
  for (const fid of firmIds) {
    const payer = state.firms[fid]!;
    if (payer.ownerType !== 'player' && payer.ownerType !== 'ai') continue;
    if (payer.cash <= 0) continue;
    const recent = payer.accounting.dailyHistory.slice(-7);
    const base = recent.length
      ? recent.reduce((s, d) => s + Math.max(0, d.netProfit), 0) / recent.length
      : Math.max(0, netProfit(payer.accounting.today));
    const pool = Math.min(Math.round(base * DIVIDEND_PAYOUT_RATIO), payer.cash);
    if (pool > 0) pools.set(fid, pool);
  }

  for (const fid of firmIds) {
    const pool = pools.get(fid);
    if (!pool) continue;
    const payer = state.firms[fid]!;

    let paidToHolders = 0;
    for (const hid of firmIds) {
      if (hid === fid) continue;
      const holder = state.firms[hid]!;
      const pct = holder.sharesHeld[fid] ?? 0;
      if (pct <= 0) continue;
      const amount = Math.floor((pool * pct) / 100);
      if (amount <= 0) continue;
      paidToHolders += amount;
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
    // Public float's share leaves to the outside world.
    const publicShare = pool - paidToHolders;
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
