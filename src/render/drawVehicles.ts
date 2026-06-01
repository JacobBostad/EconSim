/**
 * drawVehicles.ts — draws in-transit shipments as small moving squares with a
 * faint line to their destination.
 */

import type { Camera } from './camera';
import { worldToScreen } from './camera';
import type { GameState } from '../sim/core/GameState';

export function drawVehicles(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  state: GameState,
  selectedId: string | null,
): void {
  for (const id in state.vehicles) {
    const v = state.vehicles[id]!;
    if (v.status !== 'enroute') continue;
    const p = worldToScreen(cam, v.currentLocation);
    const dest = worldToScreen(cam, v.targetLocation);

    ctx.strokeStyle = 'rgba(210,168,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(dest.x, dest.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const s = id === selectedId ? 6 : 4;
    ctx.fillStyle = '#d2a8ff';
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
}
