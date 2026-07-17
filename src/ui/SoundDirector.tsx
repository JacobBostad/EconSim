import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { getWorldEventDef } from '../sim/data/worldEvents';
import { playAchievement, playMission, playNews } from './sound';

/**
 * Watches simulation state and fires sound stings on notable moments:
 * achievement unlocks, mission completions, and world-event starts.
 * Baselines silently on mount (and after new game/load shrinks counters)
 * so restored saves don't replay a burst of old sounds. Renders nothing.
 */
export function SoundDirector(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();

  const seen = useRef<{ ach: number; mis: number; world: string } | null>(null);
  const worldKey = state.worldEvents.map((e) => `${e.defId}:${e.startDay}`).join(',');

  useEffect(() => {
    const cur = { ach: state.achievements.length, mis: state.missions.length, world: worldKey };
    const prev = seen.current;
    seen.current = cur;
    if (prev === null) return; // baseline on mount

    if (cur.ach > prev.ach) playAchievement();
    else if (cur.mis > prev.mis) playMission();

    if (cur.world !== prev.world) {
      const prevSet = new Set(prev.world.split(',').filter(Boolean));
      const added = cur.world.split(',').filter((k) => k && !prevSet.has(k));
      if (added.length > 0) {
        const def = getWorldEventDef(added[0]!.split(':')[0]!);
        if (def) {
          playNews(def.severity === 'success' ? 'good' : def.severity === 'info' ? 'neutral' : 'bad');
        }
      }
    }
  }, [state.achievements.length, state.missions.length, worldKey]);

  return null;
}
