import React, { useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { companyValuation, playerRank } from '../sim/selectors/companySelectors';
import { OBJECTIVE_VALUATION } from '../sim/data/constants';
import { formatMoney } from '../utils/formatMoney';

/** Celebratory banner when the player hits the valuation objective. */
export function ObjectiveBanner(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const [dismissed, setDismissed] = useState(false);
  const state = sim.getState();
  const val = companyValuation(state, state.playerFirmId);
  const rank = playerRank(state);
  if (dismissed || val.valuation < OBJECTIVE_VALUATION) return null;

  const leader = rank.rank === 1;
  return (
    <div className="objective-banner">
      <span>
        🏆 <strong>Objective reached</strong> — company value {formatMoney(val.valuation)}
        {leader ? ' and you are the #1 firm in town!' : `. You rank #${rank.rank}/${rank.total} — overtake the leader!`}
        {' '}Keep building, or start a new town.
      </span>
      <button onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}
