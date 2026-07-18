import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { getWorldEventDef } from '../sim/data/worldEvents';
import { playAchievement, playMission, playNews, playReceivership, playFanfare, playBuildChime, playPoachAlert } from './sound';
import { CHALLENGE_END_DAY } from '../sim/selectors/reportSelectors';
import { computeTime } from '../sim/core/Tick';

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

  const seen = useRef<{ ach: number; mis: number; world: string; lastEventId: string; insolvent: boolean; challengeDone: boolean } | null>(null);
  const worldKey = state.worldEvents.map((e) => `${e.defId}:${e.startDay}`).join(',');
  const player = state.firms[state.playerFirmId];
  const insolvent = player?.bankruptcyStatus === 'insolvent';
  const challengeDone = state.config.challengeMode && computeTime(state.tick, state.config).day >= CHALLENGE_END_DAY;
  const lastEventId = state.events.length > 0 ? state.events[state.events.length - 1]!.id : '';

  useEffect(() => {
    const cur = {
      ach: state.achievements.length, mis: state.missions.length, world: worldKey,
      lastEventId, insolvent, challengeDone,
    };
    const prev = seen.current;
    seen.current = cur;
    if (prev === null) return; // baseline on mount

    if (insolvent && !prev.insolvent) playReceivership();
    if (challengeDone && !prev.challengeDone) playFanfare();

    // Scan events emitted since the previous newest one (list is bounded, so
    // walk back from the tail until we hit the last id we saw).
    if (lastEventId && lastEventId !== prev.lastEventId) {
      const fresh: string[] = [];
      for (let i = state.events.length - 1; i >= 0; i--) {
        const ev = state.events[i]!;
        if (ev.id === prev.lastEventId) break;
        fresh.push(ev.message);
        if (fresh.length > 20) break; // sound at most once per burst anyway
      }
      const playerName = player?.name ?? '';
      // A player takeover outranks every other sting this tick.
      if (playerName && fresh.some((m) => m.includes(`🤝 ${playerName} acquired`))) playFanfare();
      else if (fresh.some((m) => m.includes('left you for'))) playPoachAlert();
      else if (fresh.some((m) => m.includes('Rush order complete'))) playMission();
      else if (fresh.some((m) => m.includes('Rush order from'))) playNews('good');
      else if (fresh.some((m) => m.includes('rush order lapsed'))) playNews('bad');
      // Wholesale moments that name the player: winning a customer is good
      // news, being dropped for gouging is bad news.
      else if (playerName && fresh.some((m) =>
        m.includes(`locally from ${playerName}`) || m.includes(`order to ${playerName}`))) playNews('good');
      else if (playerName && fresh.some((m) => m.includes(`dropped ${playerName}`))) playNews('bad');
      else if (fresh.some((m) => m.includes('opens a roastery') || m.includes('built') && m.includes('Residences'))) playBuildChime();
    }

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
  }, [state.achievements.length, state.missions.length, worldKey, lastEventId, insolvent, challengeDone]);

  return null;
}
