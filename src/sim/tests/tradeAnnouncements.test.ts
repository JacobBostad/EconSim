import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { tradeAnnouncementMult, ANNOUNCE_LEAD_DAYS } from '../systems/TradeAnnouncementSystem';
import { cityPrice } from '../core/Trade';
import { getProduct } from '../data/products';

describe('Trade announcements', () => {
  it('rolls deterministically from the seed — same town, same news', () => {
    const a = newSim(11);
    const b = newSim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 60);
    b.run(tpd * 60);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
    // The news actually breaks within 60 days at a 7% daily roll.
    expect(a.getState().events.some((e) => e.message.includes('📯'))).toBe(true);
  });

  it('gives real warning, moves the walk toward the shock, then expires', () => {
    const sim = newSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    // Plant a surge by hand: announced now, effective in LEAD days.
    const effectDay = ANNOUNCE_LEAD_DAYS; // sim starts at day 0
    state.tradeAnnouncement = {
      cityId: 'ironvale', productId: 'tools', mult: 1.5,
      announcedDay: 0, effectDay, durationDays: 5,
    };
    const base = getProduct('tools').basePrice;
    // Before the effect day the multiplier is dormant.
    expect(tradeAnnouncementMult(state, 'ironvale', 'tools', effectDay - 1)).toBe(1);
    expect(tradeAnnouncementMult(state, 'ironvale', 'tools', effectDay)).toBe(1.5);
    expect(tradeAnnouncementMult(state, 'port_rosa', 'tools', effectDay)).toBe(1); // other city untouched
    expect(tradeAnnouncementMult(state, 'ironvale', 'bread', effectDay)).toBe(1); // other product untouched
    expect(tradeAnnouncementMult(state, 'ironvale', 'tools', effectDay + 5)).toBe(1); // expired

    // Live: run through the window; the center pull drags the quote up.
    const before = cityPrice(state, 'ironvale', 'tools');
    sim.run(tpd * (ANNOUNCE_LEAD_DAYS + 4));
    const during = cityPrice(sim.getState(), 'ironvale', 'tools');
    expect(during).toBeGreaterThan(before);
    expect(during).toBeGreaterThan(base); // pulled above the ordinary center
    // After the window the announcement clears itself.
    sim.run(tpd * 4);
    expect(sim.getState().tradeAnnouncement).toBeNull();
  });

  it('announcements move prices, not money', () => {
    const sim = newSim(11);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * 60);
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
  });
});
