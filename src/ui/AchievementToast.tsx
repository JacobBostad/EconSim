import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { getAchievementDef } from '../sim/data/achievements';

const TOAST_MS = 6000;

/**
 * Pops a celebratory toast when a new achievement unlocks (auto-hides).
 * Watches the length of state.achievements across renders; on first mount it
 * baselines silently so loading an old save doesn't replay every unlock.
 */
export function AchievementToast(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const list = sim.getState().achievements;
  const seenCount = useRef<number | null>(null);
  const [toast, setToast] = useState<{ id: string; at: number } | null>(null);

  useEffect(() => {
    if (seenCount.current === null) {
      seenCount.current = list.length; // baseline: don't replay old unlocks
      return;
    }
    if (list.length > seenCount.current) {
      const latest = list[list.length - 1]!;
      seenCount.current = list.length;
      setToast({ id: latest.id, at: Date.now() });
      const t = setTimeout(() => setToast(null), TOAST_MS);
      return () => clearTimeout(t);
    }
    // A new game/load can shrink the list — re-baseline.
    if (list.length < seenCount.current) seenCount.current = list.length;
  }, [list.length]);

  if (!toast) return null;
  const def = getAchievementDef(toast.id);
  if (!def) return null;

  return (
    <div className="achievement-toast" onClick={() => setToast(null)}>
      <span className="award-icon">{def.icon}</span>
      <span>
        <strong>Achievement unlocked!</strong>
        <br />
        {def.name} — {def.description}
      </span>
    </div>
  );
}
