import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { townOf } from '../sim/core/Town';

const TOAST_MS = 7000;

/**
 * The takeover moment: acquiring a rival is the biggest single move in the
 * game, and it used to pass with one event-log line. Watches the player's
 * acquiredNames roll (same baseline-on-mount pattern as AchievementToast so
 * loading a save doesn't replay old conquests) and pops a banner naming the
 * absorbed firm. The fanfare sting lives in SoundDirector.
 */
export function TakeoverToast(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  // This watcher observes the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
  const names = town.firms[state.playerFirmId]?.acquiredNames ?? [];
  const seenCount = useRef<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (seenCount.current === null) {
      seenCount.current = names.length; // baseline: don't replay old takeovers
      return;
    }
    if (names.length > seenCount.current) {
      seenCount.current = names.length;
      setToast(names[names.length - 1]!);
      const t = setTimeout(() => setToast(null), TOAST_MS);
      return () => clearTimeout(t);
    }
    if (names.length < seenCount.current) seenCount.current = names.length;
  }, [names.length]);

  if (!toast) return null;
  return (
    <div className="achievement-toast" onClick={() => setToast(null)}>
      <span className="award-icon">🤝</span>
      <span>
        <strong>Takeover complete!</strong>
        <br />
        {toast} is yours — facilities, staff, brands, and contracts absorbed.
      </span>
    </div>
  );
}
