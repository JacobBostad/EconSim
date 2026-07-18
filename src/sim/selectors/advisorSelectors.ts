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
import { getTradeCity } from '../data/tradeCities';

export interface Advice {
  icon: string;
  severity: 'danger' | 'warning' | 'info';
  text: string;
}

const MAX_ITEMS = 5;

export function morningBriefing(state: GameState): Advice[] {
  const player = state.firms[state.playerFirmId];
  if (!player) return [];
  const items: Advice[] = [];

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
      items.push({
        icon: '🏭',
        severity: 'warning',
        text: `${fac.name} produced nothing yesterday — ${fac.yesterdayStats.bottleneck}.`,
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
      items.push({
        icon: '💸',
        severity: 'warning',
        text: `${worst.name} is your money pit — averaging ${formatMoney(-worst.emaNet)}/day of losses after wages and upkeep (7-day view). Restaff, reprice, or sell it (see Company → Facilities).`,
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
      if (state.firms[fac.ownerFirmId]?.ownerType !== 'ai') continue;
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
    for (const pid of Object.keys(state.marketStats)) {
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

  const order = { danger: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return items.slice(0, MAX_ITEMS);
}
