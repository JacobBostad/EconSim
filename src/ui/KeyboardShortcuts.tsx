import React, { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Speed } from '../sim/core/Commands';

const SPEED_KEYS: Record<string, Speed> = { '1': 1, '2': 5, '3': 20, '4': 100 };

/**
 * Global keyboard shortcuts (ignored while typing in inputs):
 *   Space      pause / resume
 *   1 2 3 4    speeds 1× / 5× / 20× / 100×
 *   G          Gazette · C Company · M Market · A Awards (toggle)
 *   Escape     close dashboard / cancel placement (placement handled in MapView)
 */
export function KeyboardShortcuts(): React.ReactElement | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      const store = useGameStore.getState();
      if (e.key === ' ') {
        e.preventDefault();
        store.togglePause();
        return;
      }
      const speed = SPEED_KEYS[e.key];
      if (speed !== undefined) {
        store.setSpeed(speed);
        return;
      }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        store.toggleFlowOverlay();
        return;
      }
      const tabByKey: Record<string, 'gazette' | 'company' | 'market' | 'awards'> = {
        g: 'gazette', c: 'company', m: 'market', a: 'awards',
      };
      const tab = tabByKey[e.key.toLowerCase()];
      if (tab && !e.metaKey && !e.ctrlKey && !e.altKey) {
        store.setDashboard(store.dashboard === tab ? 'none' : tab);
        return;
      }
      if (e.key === 'Escape' && store.dashboard !== 'none') {
        store.setDashboard('none');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
