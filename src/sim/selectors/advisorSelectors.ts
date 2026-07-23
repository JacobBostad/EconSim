/**
 * advisorSelectors — the morning briefing.
 *
 * Rolls the game's insight streams (P&L, production bottlenecks, labor
 * market, hungry markets, Port Rosa) into a handful of prioritized,
 * actionable one-liners for the player. Pure over GameState; every rule
 * reads signals other systems already maintain.
 */

import type { GameState } from '../core/GameState';
import { dailyInsight, rivalTopWage, facilityPnL } from './companySelectors';
import { computeTime } from '../core/Tick';
import { spendingPower } from './citizenSelectors';
import { getProduct } from '../data/products';
import { getQuantity } from '../entities/Inventory';
import { formatMoney } from '../../utils/formatMoney';
import { pickBestCity } from '../core/Trade';
import { getTradeCity, TRADE_CITY_IDS } from '../data/tradeCities';
import { poolCoverDays } from '../data/tradePool';
import { PRODUCT_IDS_BY_PRESET } from '../data/products';
import { FOUNDER_GAP_DAYS, TRADE_POOL_THIN_COVER_DAYS } from '../data/constants';
import { founderMaxAiFirms } from '../systems/AIFounderSystem';
import { townOf } from '../core/Town';

export interface Advice {
  icon: string;
  severity: 'danger' | 'warning' | 'info';
  text: string;
}

const MAX_ITEMS = 5;

export function morningBriefing(state: GameState): Advice[] {
  // Home-town view (identity in a one-town region, so the returned record is the
  // same reference); gains a `townId` param at the endgame move.
  const firms = townOf(state).firms;
  const player = firms[state.playerFirmId];
  if (!player) return [];
  const items: Advice[] = [];

  // 0. Runway: at the recent burn rate, when does the cash hit zero? The
  // most important number a struggling firm never computes for itself —
  // missed payroll and receivership used to arrive with no countdown.
  const hist = player.accounting.dailyHistory;
  if (hist.length >= 3 && player.cash > 0) {
    const recent = hist.slice(-7);
    const avgNet = recent.reduce((sum, d) => sum + d.operatingProfit, 0) / recent.length;
    if (avgNet < -1_00) {
      const days = Math.floor(player.cash / -avgNet);
      if (days <= 15) {
        items.push({
          icon: '⏳',
          severity: days <= 5 ? 'danger' : 'warning',
          text: `~${days} day${days === 1 ? '' : 's'} of cash left at the current burn (${formatMoney(-avgNet)}/day average). Cut costs, raise prices, or borrow before payroll bounces.`,
        });
      }
    }
  }

  // 1. Money: yesterday's loss and its dominant cost.
  const insight = dailyInsight(state, player.id);
  if (insight && insight.net < 0 && insight.topCostAmount > 0) {
    items.push({
      icon: '📉',
      severity: 'danger',
      text: `Yesterday lost ${formatMoney(-insight.net)} — biggest cost was ${insight.topCostLabel} (${formatMoney(insight.topCostAmount)}).`,
    });
  }

  // 1b. Debt service eating the margin: interest is easy to forget because it
  // never shows up as a decision — only as a quiet daily drain.
  const lastDay = player.accounting.dailyHistory[player.accounting.dailyHistory.length - 1];
  if (lastDay && player.debt > 0 && lastDay.interest >= Math.max(50, lastDay.revenue * 0.15)) {
    items.push({
      icon: '🏦',
      severity: 'warning',
      text: `Debt service cost ${formatMoney(lastDay.interest)} yesterday on ${formatMoney(player.debt)} of loans — repay from your company's Loans panel when cash allows.`,
    });
  }

  // 2. Production blocked all day. Reads the closed-day snapshot, not the
  // mid-day partial stats — otherwise the alert only appeared late in the day.
  for (const facId of player.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    if (fac.activeRecipeId && fac.yesterdayStats.ticksActive === 0 && fac.yesterdayStats.bottleneck) {
      // Saturation reads differently from starvation: a full output buffer
      // means the chain sells less than it makes, not that something broke.
      const saturated = fac.yesterdayStats.bottleneck === 'Output storage full';
      items.push({
        icon: saturated ? '📦' : '🏭',
        severity: saturated ? 'info' : 'warning',
        text: saturated
          ? `${fac.name} is ahead of your sales — output is piling up. Sell the surplus wholesale, export it, or grow the store's share before adding capacity.`
          : `${fac.name} produced nothing yesterday — ${fac.yesterdayStats.bottleneck}.`,
      });
      break; // one production alert is enough for a briefing
    }
  }

  // 2b. The money pit: the worst facility by 7-day average P&L — single days
  // flip-flop with ship/idle rhythms, so only a sustained loser gets named.
  // Day ≥ 2 so freshly built towns aren't scolded before the economy runs.
  if (computeTime(state.tick, state.config).day >= 2) {
    const rows = facilityPnL(state, player.id);
    const worst = rows[rows.length - 1];
    if (worst && worst.emaNet <= -20_00 && worst.status !== 'closed') {
      // A producer drowning in its own output isn't broken — it's oversized
      // for the chain's sales. "Sell it" is terrible advice for that case.
      const fac = state.facilities[worst.facilityId];
      let full = 0;
      if (fac) for (const pid in fac.outputInventory) full += fac.outputInventory[pid]!.quantity;
      const saturated =
        fac && fac.type !== 'retail' && fac.storageCapacity > 0 && full >= fac.storageCapacity * 0.8;
      items.push({
        icon: '💸',
        severity: 'warning',
        text: saturated
          ? `${worst.name} costs ${formatMoney(-worst.emaNet)}/day (7-day view) while its output sits unsold — find a buyer: sell wholesale, export from a warehouse, or push the store's share up. Trim staff if the surplus persists.`
          : `${worst.name} is your money pit — averaging ${formatMoney(-worst.emaNet)}/day of losses after wages and upkeep (7-day view). Restaff, reprice, or sell it (see Company → Facilities).`,
      });
    }
  }

  // 2c. The wage-ratchet trap: matching rival wages every cycle can feed
  // payroll past what the shops earn (measured: a bot doing exactly this
  // plateaued with ~$0 cash while profitable rivals compounded). Fires only
  // on a sustained pattern — real staff, real revenue, and a 7-day view
  // where wages alone eat most of it while the firm runs at a loss.
  if (hist.length >= 5 && player.employees.length > 0) {
    const recent = hist.slice(-7);
    const wages = recent.reduce((s, d) => s + d.wages, 0);
    const revenue = recent.reduce((s, d) => s + d.revenue, 0);
    const operating = recent.reduce((s, d) => s + d.operatingProfit, 0);
    if (revenue > 0 && operating < 0 && wages >= revenue * 0.6) {
      items.push({
        icon: '⚖️',
        severity: 'warning',
        text: `Payroll is eating ${Math.round((wages / revenue) * 100)}% of revenue (7-day view) and you're running at a loss — wages have outpaced what your shops earn. Grow sales or trim staff before out-bidding rivals again.`,
      });
    }
  }

  // 3. Labor: a rival out-pays your crew past the poaching bar.
  const rivalWage = rivalTopWage(state, player.id);
  if (player.employees.length > 0 && rivalWage >= player.wagePolicy.baseWage * 1.15) {
    items.push({
      icon: '🤝',
      severity: 'warning',
      text: `A rival pays ${formatMoney(rivalWage)}/day (≥1.15× your wage) — your workers may defect. See the Wages card.`,
    });
  }

  // 4. Demand: hungry markets worth entering.
  const spend = spendingPower(state);
  if (spend.hungryMarkets.length > 0) {
    items.push({
      icon: '💡',
      severity: 'info',
      text: `Hungry market${spend.hungryMarkets.length > 1 ? 's' : ''}: ${spend.hungryMarkets.join(', ')} — demand outruns supply. First mover wins.`,
    });
  }

  // 4b. Sourcing: the player imports something a local firm has piled up —
  // wholesale runs ~70% of market vs the importer's 1.5× base markup.
  outer: for (const cid in state.contracts) {
    const ctr = state.contracts[cid]!;
    if (!ctr.active || ctr.ownerFirmId !== player.id) continue;
    const src = state.facilities[ctr.sourceFacilityId];
    if (!src || src.type !== 'importer') continue;
    for (const fid in state.facilities) {
      const fac = state.facilities[fid]!;
      if (fac.ownerFirmId === player.id || fac.type === 'importer') continue;
      if (firms[fac.ownerFirmId]?.ownerType !== 'ai') continue;
      if (getQuantity(fac.outputInventory, ctr.productId) >= 30) {
        items.push({
          icon: '🤝',
          severity: 'info',
          text: `You import ${getProduct(ctr.productId).name}, but ${fac.name} has a local surplus — a wholesale contract (~70% of market) beats the importer's premium.`,
        });
        break outer;
      }
    }
  }

  // 5. Trade: some port pays a premium for something you actually hold.
  for (const facId of player.facilities) {
    const fac = state.facilities[facId];
    if (!fac) continue;
    let found = false;
    for (const pid of Object.keys(townOf(state).marketStats)) {
      const best = pickBestCity(state, pid);
      const base = getProduct(pid).basePrice;
      if (best.price < base * 1.3) continue;
      const held = getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid);
      if (held >= 10) {
        const city = getTradeCity(best.cityId);
        items.push({
          icon: city.emoji,
          severity: 'info',
          text: `${city.name} pays ${(best.price / base).toFixed(2)}× base for ${getProduct(pid).name} and you hold ${held} — stage them in a warehouse and export.`,
        });
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // 5b. Trade (Arc E, pool-on): a trade city's larder is running THIN on
  // something the player actually holds, so shipping into the premium pays.
  // This is COVER-driven, not walk-price-driven like #5 above: a pooled city
  // can drain its shelf below the desk's 🔥 bar (paying up) even while the walk
  // sits at center, and #5's `best.price >= 1.3× base` test would miss it.
  // Pure over state — no rng; the pool only exists flag-on, so this is inert in
  // every pinned (flag-off) run by construction (pool is undefined → skipped).
  // Sorted-product iteration; fires on the first held short product, one line.
  poolThin: for (const facId of player.facilities) {
    const fac = state.facilities[facId];
    if (!fac) continue;
    for (const cid of TRADE_CITY_IDS) {
      const pool = state.tradeCities[cid]?.pool;
      if (!pool) continue;
      for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
        const stock = pool.inventory[pid];
        if (stock === undefined) continue; // not a product this city stocks
        if (poolCoverDays(cid, pid, stock) >= TRADE_POOL_THIN_COVER_DAYS) continue; // not thin
        const held = getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid);
        if (held < 10) continue; // nothing exportable to ship in
        const city = getTradeCity(cid);
        items.push({
          icon: '🔥',
          severity: 'info',
          text: `${city.name} is running thin on ${getProduct(pid).name} (${poolCoverDays(cid, pid, stock).toFixed(1)}d cover) and you hold ${held} — stage them in a warehouse and export into the premium before its larder refills.`,
        });
        break poolThin;
      }
    }
  }

  // Emigration pressure: the town has been miserable for days and families
  // will start leaving once the grace period runs out. Demand itself is at
  // stake — every departing household is a customer gone.
  if (state.emigrationPressure >= 3) {
    items.push({
      icon: '🧳',
      severity: 'warning',
      text: `Families are close to leaving town — ${state.emigrationPressure} straight days of deep misery. Raise wages, fill shelves, or watch your customers move away.`,
    });
  }

  // Open market closing: a staple gap has run half the founder clock. Capital
  // is watching the same counter the founder system reads — warn while the
  // player can still claim the market instead of meeting a new rival in it.
  const aiFirms = Object.values(firms).filter((f) => f.ownerType === 'ai').length;
  if (aiFirms < founderMaxAiFirms(state.config)) {
    for (const pid of ['bread', 'tools', 'clothes']) {
      const gap = state.marketGapDays[pid] ?? 0;
      if (gap < FOUNDER_GAP_DAYS / 2) continue;
      const playerSells = player.facilities.some((fid) => {
        const fac = state.facilities[fid];
        return (
          !!fac &&
          fac.status !== 'closed' &&
          fac.employees.length > 0 &&
          fac.retailProductIds.includes(pid)
        );
      });
      if (playerSells) continue;
      items.push({
        icon: '🏗️',
        severity: 'warning',
        text: `Nobody sells ${getProduct(pid).name} — a rival will move in if the gap persists (${gap}/${FOUNDER_GAP_DAYS} days). Claim the market first.`,
      });
      break; // one open-market warning per briefing
    }
  }

  const order = { danger: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  // Announced trade shock still pending: the informed-trader window is open.
  // Only shown when the player owns a warehouse — otherwise it's not
  // actionable (and building one just for the play rarely pays; probed).
  const ann = state.tradeAnnouncement;
  if (ann) {
    const day = computeTime(state.tick, state.config).day;
    const ownsWarehouse = player.facilities.some(
      (fid) => state.facilities[fid]?.type === 'warehouse',
    );
    if (day < ann.effectDay && ownsWarehouse) {
      const city = getTradeCity(ann.cityId);
      const name = getProduct(ann.productId).name;
      items.push(
        ann.mult > 1
          ? {
              icon: '📯',
              severity: 'info',
              text: `${city.name} pays ~${ann.mult}× for ${name} from day ${ann.effectDay + 1} — stage it in your warehouse now and sell into the move.`,
            }
          : {
              icon: '📯',
              severity: 'info',
              text: `${name} slides in ${city.name} from day ${ann.effectDay + 1} (~${ann.mult}×) — lock a forward at today's quote before the drop.`,
            },
      );
    }
  }

  return items.slice(0, MAX_ITEMS);
}
