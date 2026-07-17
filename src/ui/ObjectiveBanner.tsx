import React, { useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { objectiveProgress, playerRank } from '../sim/selectors/companySelectors';
import { formatMoney } from '../utils/formatMoney';

/**
 * Celebratory banner each time the player reaches a new tier on the objective
 * ladder (Tycoon → Magnate → Business Empire). Dismissal is per-tier, so the
 * next milestone celebrates again.
 */
export function ObjectiveBanner(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const [dismissedTier, setDismissedTier] = useState(0);
  const state = sim.getState();
  const prog = objectiveProgress(state);
  const rank = playerRank(state);
  if (prog.reachedTiers === 0 || prog.reachedTiers <= dismissedTier) return null;

  const leader = rank.rank === 1;
  return (
    <div className="objective-banner">
      <span>
        🏆 <strong>{prog.reachedTitle}!</strong> — company value {formatMoney(prog.valuation)}
        {leader ? ', and you are the #1 firm in town!' : `. You rank #${rank.rank}/${rank.total} — overtake the leader!`}
        {prog.next
          ? ` Next objective: ${formatMoney(prog.next.valuation)} (${prog.next.title}).`
          : ' You have completed every objective — the town is yours.'}
      </span>
      <button onClick={() => setDismissedTier(prog.reachedTiers)}>Dismiss</button>
    </div>
  );
}
