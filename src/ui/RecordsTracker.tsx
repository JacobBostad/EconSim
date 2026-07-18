import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { objectiveProgress } from '../sim/selectors/companySelectors';
import { currentDay } from '../sim/selectors/reportSelectors';
import { updateRecords } from './records';

/** Silently keeps the cross-town Hall of Records fresh. Renders nothing. */
export function RecordsTracker(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const lastCheck = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastCheck.current < 5000) return; // cheap: every ~5s of play
    lastCheck.current = now;
    const state = sim.getState();
    const prog = objectiveProgress(state);
    // Prefer the recorded unlock day of the Tycoon achievement (exact) over
    // the current day (an upper bound when loading an older save).
    const tycoon = state.achievements.find((a) => a.id === 'tycoon');
    updateRecords({
      day: tycoon?.day ?? currentDay(state),
      valuation: prog.valuation,
      achievements: state.achievements.length,
      tycoonReached: prog.reachedTiers >= 1 || tycoon !== undefined,
    });
  });

  return null;
}
