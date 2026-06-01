/**
 * drawCitizens.ts — draws citizens as small dots colored by current activity.
 */

import type { Camera } from './camera';
import { worldToScreen } from './camera';
import type { GameState } from '../sim/core/GameState';
import type { CitizenActivity } from '../sim/entities/Citizen';

const ACTIVITY_COLOR: Record<CitizenActivity, string> = {
  sleeping: '#4b5263',
  home: '#6e7681',
  'commuting-to-work': '#58a6ff',
  working: '#3fb950',
  'commuting-to-shop': '#d2a8ff',
  shopping: '#f0883e',
  'commuting-home': '#8b949e',
};

export function drawCitizens(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  state: GameState,
  selectedId: string | null,
): void {
  for (const id in state.citizens) {
    const c = state.citizens[id]!;
    const p = worldToScreen(cam, c.currentLocation);
    const selected = id === selectedId;
    ctx.beginPath();
    ctx.arc(p.x, p.y, selected ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = ACTIVITY_COLOR[c.activity] ?? '#8b949e';
    ctx.fill();
    if (selected) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }
}

export { ACTIVITY_COLOR };
