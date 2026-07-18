import React, { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { computeTime } from '../sim/core/Tick';
import { startMusic, stopMusic, setMusicMood } from './music';

/**
 * Drives the ambient soundtrack: arms a one-time pointer listener so the
 * AudioContext can start after the first user gesture (autoplay policy),
 * and steers the music's day/night mood from the town clock. Renders
 * nothing. The music module itself handles mute/toggle/hidden-tab ducking.
 */
export function MusicDirector(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const hour = computeTime(state.tick, state.config).hour;

  useEffect(() => {
    const onFirstGesture = (): void => {
      startMusic();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture);
    window.addEventListener('keydown', onFirstGesture);
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      stopMusic();
    };
  }, []);

  useEffect(() => {
    setMusicMood(hour >= 7 && hour < 20 ? 'day' : 'night');
  }, [hour]);

  return null;
}
