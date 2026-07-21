/**
 * ai/finance.ts — the operator's capital-side behaviors: park spare cash in
 * rival equity, deleverage expansion loans, export a glutted plant's surplus,
 * and absorb a dying rival at the distressed discount.
 *
 * ARCHETYPE SEAM (Arc D1, for D3). `maybeBuyShares` / `maybeBuyStakeCity` are
 * the INVESTOR seam: today an operator builds an equity book as a side use of
 * surplus cash; D3's investor (holdco) archetype will own portfolio management
 * as its whole loop — yield hunting, stake laddering toward control, dividend
 * harvesting. Per the D1 mandate these B2/B3 behaviors STAY in the operator
 * loop's cadence for now (portfolio buying here, distress buying via
 * `maybeRescueAcquisition`); D3 lifts them out, this arc does not reshuffle.
 */

import type { SimContext } from '../../core/GameState';
import { emitEvent, recordTransaction, reindexContracts } from '../../core/GameState';
import { contractsBySource } from '../../core/ContractIndex';
import { firmAccount, WORLD_ACCOUNT } from '../../core/Transactions';
import { formatMoney } from '../../../utils/formatMoney';
import { getProduct } from '../../data/products';
import { getQuantity, removeStock } from '../../entities/Inventory';
import { MAX_STAKE_PCT, DIVIDEND_PAYOUT_RATIO } from '../../data/constants';
import { marketCap, operatingValuationOf } from '../../selectors/companySelectors';
import { tradeShares, sharePricePerPct } from '../../core/Shares';
import { smoothedProfitBase } from '../DividendSystem';
import { acquisitionCost, performAcquisition } from '../../core/Acquisition';
import { getPersonality, ceoQuote } from '../../data/personalities';
import { pickBestCity } from '../../core/Trade';
import { getTradeCity } from '../../data/tradeCities';

/**
 * When very flush, AI firms park spare cash in rival equity (including the
 * player's!) for dividend income — 5% at a time, capped at a 25% stake, and
 * never spending below a healthy cash buffer. Mirrors the pricing used by the
 * player's BUY_SHARES command so the market feels consistent.
 *
 * Two dispatchers by scale. Village keeps the classic "buy into the most
 * valuable rival" path verbatim — every rng draw in the exact order it always
 * took — so the 300-day bit-identity baseline is untouched. City routes to the
 * Arc B2 yield-based path (maybeBuyStakeCity), which is structurally impossible
 * to reach in a Village, so none of its new logic can perturb that baseline.
 */
const AI_SHARE_CASH_FLOOR = 35000_00; // keep at least $35k after buying
const AI_MAX_STAKE = 25;

export function maybeBuyShares(ctx: SimContext, firmId: string): void {
  if (ctx.state.config.sizePreset !== 'village') {
    maybeBuyStakeCity(ctx, firmId);
    return;
  }
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.cash < AI_SHARE_CASH_FLOOR || !rng.chance(0.12)) return;

  // Target the most valuable other company still below our stake cap.
  let target: string | null = null;
  let targetVal = 0;
  for (const fid in state.firms) {
    if (fid === firmId) continue;
    const other = state.firms[fid]!;
    if (other.ownerType !== 'player' && other.ownerType !== 'ai') continue;
    if ((firm.sharesHeld[fid] ?? 0) >= AI_MAX_STAKE) continue;
    const val = marketCap(state, fid);
    if (val > targetVal) {
      targetVal = val;
      target = fid;
    }
  }
  if (!target) return;

  // Fees and fill impact land on top of the quote — budget with headroom.
  const cost = Math.round(5 * sharePricePerPct(state, target) * 1.05);
  if (firm.cash - cost < AI_SHARE_CASH_FLOOR) return;

  // Same path as the player's BUY_SHARES — any market rule applies to AI too.
  if (tradeShares(state, firmId, target, 5)) {
    emitEvent(state, 'info', 'ai',
      `${firm.name} now holds ${firm.sharesHeld[target]}% of ${state.firms[target]!.name}.${ceoQuote(rng, firm, 'shares')}`,
      target);
  }
}

/**
 * Arc B2 — city-scale yield-based stake buying. A solvent, flush AI parks
 * surplus cash in the rival whose dividend pays the most per dollar of price:
 * the target's smoothed dividend base over its marketCap (the same base the
 * dividend actually pays from — DividendSystem.smoothedProfitBase). Only
 * profitable, healthy, operating-solvent firms qualify — the classic "highest
 * valuation" rule (Village) happily bought the priciest firm about to fold,
 * paying the most per dividend dollar; this inverts that.
 *
 * RNG discipline: this deliberately keeps the Village path's exact draw
 * structure — the same $35k floor short-circuit, the same rng.chance(0.12)
 * cadence, the same 5% block size, the same ceoQuote(rng) on success — and
 * changes ONLY deterministic logic (which target, and the persona-scaled cap).
 * The city economy is chaotic and the A3 crowd/tier acceptance bands are pinned
 * to its rng trajectory; perturbing the draw cadence (not just the outcome)
 * reshuffles that trajectory wholesale. Persona appetite therefore expresses
 * "aggressive personalities buy more" through the deterministic stake CAP — an
 * expansionist accumulates toward 40%, an exporter stops near 18% — not through
 * frequency, so no rng draw moves. tradeShares enforces MAX_STAKE_PCT, the city
 * float cap, the 3% fee and price impact; a stake reaching CONTROL_BLOCK_PCT
 * earns the takeover veto through the same ladder the player uses.
 */
const AI_CITY_STAKE_BASE_CAP = 25; // neutral stake cap; scaled by appetite (≤ MAX_STAKE_PCT)
// Minimum trailing yield (smoothed daily net ÷ marketCap) worth buying for.
// Pinned by the city-soak B2 probe: below this the dividend after the 3% fee is
// noise; the surviving buyers at day 300 clear well above it (seed 11).
const AI_CITY_YIELD_MIN = 0.0005;

function maybeBuyStakeCity(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  // Identical gate to the Village path: same floor, same cadence draw, same
  // order — so the shared rng stream advances the same way regardless of scale.
  if (firm.cash < AI_SHARE_CASH_FLOOR || !rng.chance(0.12)) return;

  const appetite = getPersonality(firm.personalityId).stakeAppetite;
  const cap = Math.min(MAX_STAKE_PCT, Math.round(AI_CITY_STAKE_BASE_CAP * appetite));

  // Highest dividend yield among profitable, healthy, operating-solvent rivals
  // we can still add to. Sorted scan with a strict-greater compare → the lowest
  // firm id wins a tie, deterministically.
  let target: string | null = null;
  let bestYield = AI_CITY_YIELD_MIN;
  for (const fid of Object.keys(state.firms).sort()) {
    if (fid === firmId) continue;
    const other = state.firms[fid]!;
    if (other.ownerType !== 'player' && other.ownerType !== 'ai') continue;
    if (other.bankruptcyStatus !== 'healthy') continue; // never buy into trouble
    if ((firm.sharesHeld[fid] ?? 0) >= cap) continue;
    const base = smoothedProfitBase(other);
    if (base <= 0) continue; // only firms actually earning
    if (operatingValuationOf(state, fid) <= 0) continue; // operating-valuation sanity
    const mcap = marketCap(state, fid);
    if (mcap <= 0) continue;
    const yieldSignal = base / mcap;
    if (yieldSignal > bestYield) {
      bestYield = yieldSignal;
      target = fid;
    }
  }
  if (!target) return;

  const want = Math.min(5, cap - (firm.sharesHeld[target] ?? 0)); // 5% block, capped by appetite
  if (want <= 0) return;
  // Fees + fill impact land on top of the quote — budget with headroom.
  const cost = Math.round(want * sharePricePerPct(state, target) * 1.05);
  if (firm.cash - cost < AI_SHARE_CASH_FLOOR) return;

  if (tradeShares(state, firmId, target, want)) {
    const yieldPct = (bestYield * DIVIDEND_PAYOUT_RATIO * 365 * 100).toFixed(0);
    emitEvent(state, 'info', 'ai',
      `${firm.name} took a ${firm.sharesHeld[target]}% dividend stake in ${state.firms[target]!.name} (~${yieldPct}%/yr yield).${ceoQuote(rng, firm, 'shares')}`,
      target);
  }
}

/**
 * Rescue consolidation: a very flush AI absorbs a distressed/insolvent AI
 * rival at the distressed discount instead of letting it die slowly. Keeps
 * the town's chains running under new ownership — and means the player isn't
 * the only consolidator in the market. Never targets the player.
 */
const RESCUE_CASH_FLOOR = 60000_00; // consider M&A above $60k cash
const RESCUE_KEEP_BUFFER = 30000_00; // never drop below $30k doing it

export function maybeRescueAcquisition(ctx: SimContext, firmId: string): boolean {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.cash < RESCUE_CASH_FLOOR || !rng.chance(0.25)) return false;
  for (const fid in state.firms) {
    if (fid === firmId) continue;
    const other = state.firms[fid]!;
    if (other.ownerType !== 'ai' || other.bankruptcyStatus === 'healthy') continue;
    const cost = acquisitionCost(state, firmId, fid);
    if (firm.cash - cost < RESCUE_KEEP_BUFFER) continue;
    const done = performAcquisition(state, firmId, fid);
    // Acquisition re-owns the target's facilities and contracts (an owner-key
    // change on every one) — rebuild the index before any later reader sees it.
    if (done) reindexContracts(ctx);
    return done;
  }
  return false;
}

/**
 * AI trade: when a production facility is glutted with finished goods and
 * Port Rosa pays ≥1.2× base, sell surplus through a broker (steeper 15% fee
 * than the player's warehouse route — the player's logistics edge is real).
 * Keeps AI chains from stalling inventory-full and gives them trade income.
 */
const AI_EXPORT_FEE = 0.15;
const AI_EXPORT_MIN_MULT = 1.2;
const AI_EXPORT_KEEP = 20; // units kept as working stock

export function maybeExportSurplus(ctx: SimContext, firmId: string): void {
  const { state, rng } = ctx;
  const firm = state.firms[firmId]!;
  const keep = Math.round(AI_EXPORT_KEEP * getPersonality(firm.personalityId).exportKeepMult);
  for (const facId of firm.facilities) {
    const fac = state.facilities[facId];
    if (!fac || (fac.type !== 'farm' && fac.type !== 'mine' && fac.type !== 'factory')) continue;
    for (const pid in fac.outputInventory) {
      const have = getQuantity(fac.outputInventory, pid);
      // Home shelves eat first: stock spoken for by active outbound supply
      // contracts is never exported, whatever the personality. Without this an
      // exporter firm ships its own shops' supply and starves the town
      // (measured: Port Haven satisfaction 1/100 by day 90 on every seed).
      let reserved = 0;
      for (const cid of contractsBySource(ctx.contractIndex, fac.id)) {
        const c = state.contracts[cid]!;
        if (c.active && c.productId === pid) {
          reserved += c.targetQuantity;
        }
      }
      const keepHere = Math.max(keep, reserved);
      if (have <= keepHere + 10) continue;
      const product = getProduct(pid);
      // Brokered AI exports route to whichever city pays best today.
      const best = pickBestCity(state, pid);
      const cityName = getTradeCity(best.cityId).name;
      if (best.price < product.basePrice * AI_EXPORT_MIN_MULT) continue;
      const qty = Math.min(have - keepHere, 40);
      const revenue = Math.round(qty * best.price * (1 - AI_EXPORT_FEE));
      removeStock(fac.outputInventory, pid, qty);
      recordTransaction(state, {
        from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: revenue,
        firmId, category: 'revenue', productId: pid, quantity: qty,
        note: `Exported ${qty} ${product.name} to ${cityName} (brokered)`,
      });
      firm.exportRevenue += revenue;
      firm.exportRevenueByCity[best.cityId] = (firm.exportRevenueByCity[best.cityId] ?? 0) + revenue;
      if (revenue >= 200_00) {
        emitEvent(state, 'info', 'ai',
          `${firm.name} exported ${qty} ${product.name} to ${cityName} for ${formatMoney(revenue)}.${ceoQuote(rng, firm, 'export')}`, fac.id);
      }
      return; // one export per firm per day
    }
  }
}

/**
 * Deleverage: expansion loans are bridges, not permanent fixtures — at ~30%/yr
 * the interest quietly eats late-game margins if debt is never repaid. When
 * cash comfortably exceeds an operating cushion, pay the loan down. The cushion
 * keeps the firm able to expand again (borrowing back is always possible).
 */
const DEBT_CASH_CUSHION = 6000_00;
const DEBT_MIN_REPAYMENT = 100_00; // skip dribble payments

export function manageDebt(ctx: SimContext, firmId: string): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  if (firm.debt <= 0) return;
  const spare = firm.cash - DEBT_CASH_CUSHION;
  if (spare < DEBT_MIN_REPAYMENT) return;
  const amount = Math.min(firm.debt, spare);
  firm.debt -= amount;
  recordTransaction(state, {
    from: firmAccount(firmId),
    to: WORLD_ACCOUNT,
    amount,
    firmId,
    category: 'loanRepay',
    note: 'Deleveraging',
  });
}
