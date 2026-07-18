import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { dailyInsight } from '../sim/selectors/companySelectors';
import { formatMoney } from '../utils/formatMoney';
import { computeTime } from '../sim/core/Tick';

/**
 * The defeat moment. When the player firm first turns 'insolvent' the sim
 * pauses and this modal explains what went wrong — silent facility closures
 * are a terrible way to discover you lost. One showing per insolvency
 * episode; recovering to solvency re-arms it.
 */
export function ReceivershipModal(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const setShowNewGame = useGameStore((s) => s.setShowNewGame);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId];
  const insolvent = player?.bankruptcyStatus === 'insolvent';
  const handled = useRef(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!insolvent) {
      handled.current = false; // recovered — re-arm for a future collapse
      return;
    }
    if (!handled.current) {
      handled.current = true;
      dispatch({ type: 'PAUSE' });
      setShow(true);
    }
  }, [insolvent]);

  if (!show || !player) return null;

  const day = computeTime(state.tick, state.config).day + 1;
  const insight = dailyInsight(state, player.id);
  const hist = player.accounting.dailyHistory;
  let lastProfitDay: number | null = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i]!.netProfit > 0) { lastProfitDay = hist[i]!.day + 1; break; }
  }
  const wageBill = player.employees.length * player.wagePolicy.baseWage;

  return (
    <div className="intro-backdrop">
      <div className="intro-card">
        <h2 style={{ margin: 0 }}>🏚 Receivership</h2>
        <p className="muted small" style={{ margin: '4px 0 10px' }}>
          Day {day} — {player.name} has been insolvent for {player.daysInsolvent} days.
          The bank is closing your costliest facilities to stem the losses.
        </p>

        <div className="kv small"><span className="k">Cash</span>
          <span className="mono" style={{ color: 'var(--red)' }}>{formatMoney(player.cash)}</span></div>
        <div className="kv small"><span className="k">Debt</span>
          <span className="mono">{formatMoney(player.debt)}</span></div>
        <div className="kv small"><span className="k">Daily wage bill</span>
          <span className="mono">{formatMoney(wageBill)}</span></div>
        {insight && (
          <div className="kv small"><span className="k">Biggest cost yesterday</span>
            <span>{insight.topCostLabel} ({formatMoney(insight.topCostAmount)})</span></div>
        )}
        <div className="kv small"><span className="k">Last profitable day</span>
          <span>{lastProfitDay ? `day ${lastProfitDay}` : 'never'}</span></div>

        <p className="small" style={{ marginTop: 10 }}>
          Ways back: sell facilities you can't staff profitably, cut wages or
          headcount, drop loss-making products from your stores, or export
          surplus stock for cash. Reaching non-negative cash restores your firm.
        </p>

        <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => { setShow(false); setShowNewGame(true); }}>
            Start fresh
          </button>
          <button className="active" onClick={() => { setShow(false); dispatch({ type: 'RESUME' }); }}>
            Fight on
          </button>
        </div>
      </div>
    </div>
  );
}
