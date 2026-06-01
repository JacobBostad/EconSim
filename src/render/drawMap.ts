/**
 * drawMap.ts — background, grid, and road hints for the town.
 */

import type { Camera } from './camera';
import { worldToScreen } from './camera';
import type { GameState } from '../sim/core/GameState';

export function drawMap(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  state: GameState,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  // Faint grid.
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const step = 10;
  for (let x = 0; x <= state.config.mapWidth; x += step) {
    const a = worldToScreen(cam, { x, y: 0 });
    const b = worldToScreen(cam, { x, y: state.config.mapHeight });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = 0; y <= state.config.mapHeight; y += step) {
    const a = worldToScreen(cam, { x: 0, y });
    const b = worldToScreen(cam, { x: state.config.mapWidth, y });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Roads: faint lines from each facility to the town center (visual hint).
  ctx.strokeStyle = 'rgba(120,140,170,0.10)';
  const center = worldToScreen(cam, {
    x: state.config.mapWidth / 2,
    y: state.config.mapHeight / 2,
  });
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    if (f.type === 'home') continue;
    const p = worldToScreen(cam, f.location);
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
}
