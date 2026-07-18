/**
 * TownRenderer — a self-contained, smooth canvas renderer for the town.
 *
 * Owns its own requestAnimationFrame loop and reads live GameState each frame,
 * so the map is always animated and correctly sized regardless of React. It:
 *  - sizes to its container via ResizeObserver at devicePixelRatio (crisp),
 *  - eases entity positions toward their live targets (buttery movement even at
 *    low tick rates),
 *  - draws ground, a road network, buildings (vector icons), shipments, and
 *    citizens, with a day/night tint and a legend,
 *  - spawns floating "+$" and goods popups when sales/deliveries/production
 *    happen, so you literally see money and product change hands,
 *  - supports wheel-zoom, drag-pan, hover tooltips, and click selection.
 */

import type { GameState } from '../sim/core/GameState';
import type { FacilityType } from '../sim/entities/Facility';
import type { CitizenActivity } from '../sim/entities/Citizen';
import { computeTime } from '../sim/core/Tick';
import { landValueAt } from '../sim/core/LandValue';
import { seasonOf } from '../sim/data/seasons';
import { getProduct } from '../sim/data/products';
import { formatMoney } from '../utils/formatMoney';

interface Vec { x: number; y: number }
interface Floater { x: number; y: number; vy: number; life: number; maxLife: number; text: string; color: string }
interface Trail { x: number; y: number; life: number }

const BUILDING_FILL: Record<FacilityType, string> = {
  home: '#5b6b8c',
  farm: '#6fbf73',
  mine: '#a98467',
  factory: '#e0a458',
  warehouse: '#7f9cc0',
  retail: '#5ab0ff',
  importer: '#c08be6',
};

const ACTIVITY_COLOR: Record<CitizenActivity, string> = {
  sleeping: '#3a4256',
  home: '#6e7681',
  'commuting-to-work': '#58a6ff',
  working: '#3fb950',
  'commuting-to-shop': '#d2a8ff',
  shopping: '#f0883e',
  'commuting-home': '#8b949e',
};

export const LEGEND_BUILDINGS: { type: FacilityType; label: string }[] = [
  { type: 'farm', label: 'Farm' },
  { type: 'mine', label: 'Mine' },
  { type: 'factory', label: 'Factory' },
  { type: 'warehouse', label: 'Warehouse' },
  { type: 'retail', label: 'Store' },
  { type: 'importer', label: 'Importer' },
  { type: 'home', label: 'Home' },
];

export interface RendererCallbacks {
  onPick: (id: string | null) => void;
  getSelectedId: () => string | null;
  getBuildMode: () => boolean;
  getFlowOverlay: () => boolean;
  onBuildAt: (world: Vec) => void;
}

export class TownRenderer {
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private raf = 0;
  private cssW = 1;
  private cssH = 1;

  // camera
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private autoFit = true;

  // interaction
  private mouse: Vec | null = null;
  private dragging = false;
  private dragStart: Vec = { x: 0, y: 0 };
  private dragMoved = false;
  private hoverId: string | null = null;

  // animation
  private smooth = new Map<string, Vec>();
  private trails: Trail[] = [];
  private floaters: Floater[] = [];
  private prevStats = new Map<string, { revenue: number; received: number; produced: number }>();
  private lastFrame = performance.now();
  private lastSeenTick = 0;
  private lastSeenSeed = NaN;

  constructor(
    private canvas: HTMLCanvasElement,
    private getState: () => GameState,
    private cb: RendererCallbacks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bindEvents();
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unbindEvents();
  }

  // --- sizing -----------------------------------------------------------
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.dpr = dpr;
  }
  private dpr = 1;

  // --- camera (auto-fits to the town's bounding box) --------------------
  private view = { scale: 1, cx: 65, cy: 46, minX: 0, minY: 0, maxX: 1, maxY: 1 };

  private updateView(s: GameState): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      if (f.location.x < minX) minX = f.location.x;
      if (f.location.y < minY) minY = f.location.y;
      if (f.location.x > maxX) maxX = f.location.x;
      if (f.location.y > maxY) maxY = f.location.y;
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = s.config.mapWidth; maxY = s.config.mapHeight; }
    const padW = 14, padH = 12;
    minX -= padW; maxX += padW; minY -= padH; maxY += padH;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const margin = 24;
    this.view.scale = Math.min((this.cssW - margin) / w, (this.cssH - margin) / h);
    this.view.cx = (minX + maxX) / 2;
    this.view.cy = (minY + maxY) / 2;
    this.view.minX = minX; this.view.minY = minY; this.view.maxX = maxX; this.view.maxY = maxY;
  }

  private effScale(): number { return this.view.scale * this.zoom; }
  private w2s(_s: GameState, p: Vec): Vec {
    const sc = this.effScale();
    return {
      x: this.cssW / 2 + this.panX + (p.x - this.view.cx) * sc,
      y: this.cssH / 2 + this.panY + (p.y - this.view.cy) * sc,
    };
  }
  private s2w(_s: GameState, p: Vec): Vec {
    const sc = this.effScale();
    return {
      x: this.view.cx + (p.x - this.cssW / 2 - this.panX) / sc,
      y: this.view.cy + (p.y - this.cssH / 2 - this.panY) / sc,
    };
  }

  // --- events -----------------------------------------------------------
  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    c.addEventListener('mouseleave', this.onLeave);
  }
  private unbindEvents(): void {
    const c = this.canvas;
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    c.removeEventListener('mouseleave', this.onLeave);
  }
  private localMouse(e: MouseEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.getState();
    this.updateView(s);
    const m = this.localMouse(e);
    const before = this.s2w(s, m);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoom = Math.max(0.4, Math.min(6, this.zoom * factor));
    this.autoFit = false;
    const after = this.w2s(s, before);
    this.panX += m.x - after.x;
    this.panY += m.y - after.y;
  };
  private onDown = (e: MouseEvent): void => {
    this.dragging = true;
    this.dragMoved = false;
    this.dragStart = this.localMouse(e);
  };
  private onMove = (e: MouseEvent): void => {
    const m = this.localMouse(e);
    this.mouse = m;
    if (this.dragging) {
      const dx = m.x - this.dragStart.x;
      const dy = m.y - this.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
      this.panX += m.x - this.dragStart.x;
      this.panY += m.y - this.dragStart.y;
      this.dragStart = m;
      this.autoFit = false;
    }
  };
  private onUp = (e: MouseEvent): void => {
    if (this.dragging && !this.dragMoved) this.handleClick(this.localMouse(e));
    this.dragging = false;
  };
  private onLeave = (): void => { this.mouse = null; };

  private handleClick(m: Vec): void {
    const s = this.getState();
    if (this.cb.getBuildMode()) {
      this.cb.onBuildAt(this.s2w(s, m));
      return;
    }
    this.cb.onPick(this.pick(s, m));
  }

  private pick(s: GameState, m: Vec): string | null {
    this.updateView(s);
    const best = { id: null as string | null, d: Infinity };
    const consider = (id: string, p: Vec, r: number) => {
      const sp = this.w2s(s, p);
      const d = Math.hypot(sp.x - m.x, sp.y - m.y);
      if (d <= r && d < best.d) { best.id = id; best.d = d; }
    };
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      consider(id, this.drawPos(id, f.location), f.type === 'home' ? 11 : 20);
    }
    for (const id in s.vehicles) {
      const v = s.vehicles[id]!;
      if (v.status === 'enroute') consider(id, this.drawPos(id, v.currentLocation), 10);
    }
    for (const id in s.citizens) consider(id, this.drawPos(id, s.citizens[id]!.currentLocation), 7);
    return best.id;
  }

  // --- smoothing --------------------------------------------------------
  private drawPos(id: string, live: Vec): Vec {
    let cur = this.smooth.get(id);
    if (!cur) { cur = { x: live.x, y: live.y }; this.smooth.set(id, cur); }
    return cur;
  }
  private ease(id: string, live: Vec, k: number): Vec {
    const cur = this.drawPos(id, live);
    cur.x += (live.x - cur.x) * k;
    cur.y += (live.y - cur.y) * k;
    return cur;
  }

  // --- main loop --------------------------------------------------------
  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    try { this.render(dt); } catch { /* never let a draw error kill the loop */ }
    this.raf = requestAnimationFrame(this.loop);
  };

  private render(dt: number): void {
    const s = this.getState();
    // Detect a New game / Load (tick jumped back or seed changed) and clear the
    // animation caches so entities don't slide in from stale positions.
    if (s.seed !== this.lastSeenSeed || s.tick < this.lastSeenTick) {
      this.smooth.clear();
      this.prevStats.clear();
      this.floaters.length = 0;
      this.trails.length = 0;
    }
    this.lastSeenSeed = s.seed;
    this.lastSeenTick = s.tick;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.autoFit) { this.panX = 0; this.panY = 0; }
    this.updateView(s);

    const time = computeTime(s.tick, s.config);
    this.drawGround(s, time.hour);
    this.drawRoads(s);
    if (this.cb.getFlowOverlay()) this.drawFlowOverlay(s, dt);
    this.drawFacilities(s, time.hour);
    this.drawShipments(s, dt);
    this.drawCitizens(s, dt);
    this.updateFloaters(s, dt);
    this.drawFloaters();
    this.drawNightTint(time.hour);
    this.drawWorldEventAmbiance(s, dt);
    if (this.cb.getBuildMode()) this.drawLandValueOverlay(s);
    this.drawHud(time);
    this.drawHover(s);
  }

  // --- supply-chain flow overlay (F) --------------------------------------
  private flowDash = 0;

  /**
   * Every active contract as a curved arrow, width scaled by shipment volume,
   * player routes in accent blue and AI routes muted; warehouses with export
   * activity get a dashed lane running off the east edge toward Port Rosa.
   */
  private drawFlowOverlay(s: GameState, dt: number): void {
    const ctx = this.ctx;
    this.flowDash = (this.flowDash + dt * 0.012) % 24;

    const route = (
      from: Vec, to: Vec, width: number, color: string, dashed: boolean,
    ): void => {
      const a = this.w2s(s, from);
      const b = this.w2s(s, to);
      // Curve control point: perpendicular offset so parallel routes separate.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const cxp = mx - (dy / len) * Math.min(30, len * 0.18);
      const cyp = my + (dx / len) * Math.min(30, len * 0.18);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.setLineDash(dashed ? [8, 8] : [12, 12]);
      ctx.lineDashOffset = -this.flowDash;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(cxp, cyp, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead at the destination.
      const tx = b.x - cxp, ty = b.y - cyp;
      const tlen = Math.max(1, Math.hypot(tx, ty));
      const ux = tx / tlen, uy = ty / tlen;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * 8 - uy * 4, b.y - uy * 8 + ux * 4);
      ctx.lineTo(b.x - ux * 8 + uy * 4, b.y - uy * 8 - ux * 4);
      ctx.closePath();
      ctx.fill();
    };

    for (const cid in s.contracts) {
      const c = s.contracts[cid]!;
      if (!c.active) continue;
      const src = s.facilities[c.sourceFacilityId];
      const dst = s.facilities[c.destinationFacilityId];
      if (!src || !dst) continue;
      const isPlayer = c.ownerFirmId === s.playerFirmId;
      const width = Math.min(4.5, 1.2 + c.targetQuantity / 25);
      const color = isPlayer ? 'rgba(90,170,255,0.75)' : 'rgba(170,180,200,0.35)';
      route(src.location, dst.location, width, color, false);
    }

    // Export lanes: any warehouse with a standing order or shipped units today.
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type !== 'warehouse') continue;
      const exporting = Object.keys(f.exportOrders).length > 0 || f.dailyStats.unitsShipped > 0;
      if (!exporting) continue;
      const isPlayer = f.ownerFirmId === s.playerFirmId;
      route(
        f.location,
        { x: s.config.mapWidth + 6, y: Math.min(f.location.y, 20) },
        1.8,
        isPlayer ? 'rgba(120,220,180,0.7)' : 'rgba(150,190,170,0.35)',
        true,
      );
    }
  }

  // --- land-value overlay (placement mode) -------------------------------
  private landGrid: { key: string; step: number; cols: number; rows: number; v: Float32Array } | null = null;

  /** Sampled land-value grid, cached until homes/residents change. */
  private landValues(s: GameState): NonNullable<TownRenderer['landGrid']> {
    let homes = 0, residents = 0;
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type === 'home') { homes += 1; residents += f.residentIds.length; }
    }
    const key = `${homes}:${residents}:${s.seed}`;
    if (this.landGrid && this.landGrid.key === key) return this.landGrid;
    const step = 4;
    const cols = Math.ceil(s.config.mapWidth / step) + 1;
    const rows = Math.ceil(s.config.mapHeight / step) + 1;
    const v = new Float32Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        v[gy * cols + gx] = landValueAt(s, { x: gx * step, y: gy * step });
      }
    }
    this.landGrid = { key, step, cols, rows, v };
    return this.landGrid;
  }

  /** Green (cheap) → red (premium) wash while the player is placing a building. */
  private drawLandValueOverlay(s: GameState): void {
    const grid = this.landValues(s);
    const ctx = this.ctx;
    const sc = this.effScale();
    ctx.save();
    for (let gy = 0; gy < grid.rows; gy++) {
      for (let gx = 0; gx < grid.cols; gx++) {
        const lv = grid.v[gy * grid.cols + gx]!;
        const p = this.w2s(s, { x: gx * grid.step, y: gy * grid.step });
        const size = grid.step * sc;
        if (p.x < -size || p.y < -size || p.x > this.cssW + size || p.y > this.cssH + size) continue;
        // Hue 120 (green) → 0 (red); stronger alpha where pricier.
        ctx.fillStyle = `hsla(${120 - lv * 120}, 75%, 45%, ${0.08 + lv * 0.16})`;
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
    ctx.restore();
    // Legend chip.
    ctx.save();
    ctx.fillStyle = 'rgba(13,17,23,0.8)';
    ctx.fillRect(this.cssW / 2 - 130, 8, 260, 22);
    ctx.fillStyle = '#e6edf3';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Land value: green = cheap (0.8×) · red = premium (1.6×)', this.cssW / 2, 23);
    ctx.restore();
  }

  // --- world-event ambiance ---------------------------------------------
  /** Full-canvas color washes per active world event (drought = dry sepia,
   * recession = gray, boom = golden…), plus drifting smog during fuel spikes.
   * Purely cosmetic; reads the same state.worldEvents the ticker shows. */
  private static readonly EVENT_TINTS: Record<string, string> = {
    drought: 'rgba(190,130,40,0.10)',
    bumper_harvest: 'rgba(70,190,90,0.06)',
    recession: 'rgba(110,115,125,0.13)',
    boom: 'rgba(255,205,90,0.07)',
    fuel_spike: 'rgba(80,70,55,0.12)',
    mine_collapse: 'rgba(130,105,80,0.10)',
    rich_vein: 'rgba(90,220,220,0.05)',
    tariffs: 'rgba(70,110,170,0.06)',
  };

  private smogT = 0;

  /** Subtle seasonal ground wash (under the event tints). */
  private static readonly SEASON_TINTS: Record<string, string> = {
    spring: 'rgba(110,200,110,0.05)',
    summer: 'rgba(240,220,110,0.05)',
    autumn: 'rgba(220,150,70,0.07)',
    winter: 'rgba(190,210,240,0.10)',
  };

  private weatherT = 0;

  /** Snow all winter; light drizzle on ~30% of spring days. Pure decoration. */
  private drawWeather(s: GameState, dt: number): void {
    const season = seasonOf(s);
    const day = Math.floor(s.tick / (s.config.ticksPerHour * 24));
    const rainy =
      season === 'spring' && (Math.imul(day ^ s.seed, 2654435761) >>> 28) < 5;
    if (season !== 'winter' && !rainy) return;
    this.weatherT += dt;
    const ctx = this.ctx;
    ctx.save();
    if (season === 'winter') {
      ctx.fillStyle = 'rgba(235,242,255,0.75)';
      for (let i = 0; i < 70; i++) {
        const h = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
        const speed = 18 + h * 26;
        const x = (h * this.cssW + Math.sin(this.weatherT / 1400 + i) * 24 + this.cssW) % this.cssW;
        const y = (h * 7919 + (this.weatherT / 1000) * speed) % (this.cssH + 8);
        ctx.globalAlpha = 0.35 + h * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, 1 + h * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(140,180,230,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 45; i++) {
        const h = (Math.imul(i + 7, 2654435761) >>> 0) / 4294967296;
        const x = (h * this.cssW + this.weatherT / 90) % this.cssW;
        const y = (h * 5417 + (this.weatherT / 1000) * (140 + h * 80)) % (this.cssH + 12);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1.5, y + 7);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawWorldEventAmbiance(s: GameState, dt: number): void {
    const ctx = this.ctx;
    const seasonTint = TownRenderer.SEASON_TINTS[seasonOf(s)];
    if (seasonTint) {
      ctx.fillStyle = seasonTint;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    this.drawWeather(s, dt);
    if (s.worldEvents.length === 0) return;
    let smog = false;
    for (const ev of s.worldEvents) {
      const tint = TownRenderer.EVENT_TINTS[ev.defId];
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
      }
      if (ev.defId === 'fuel_spike') smog = true;
    }
    if (smog) {
      this.smogT += dt;
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const px = ((this.smogT * (8 + i * 3)) / 1000 + i * 137) % (this.cssW + 240) - 120;
        const py = this.cssH * (0.12 + 0.17 * i) + Math.sin(this.smogT / 2600 + i * 2) * 12;
        ctx.globalAlpha = 0.05 + 0.02 * Math.sin(this.smogT / 1900 + i);
        ctx.fillStyle = '#8a8070';
        ctx.beginPath();
        ctx.ellipse(px, py, 90 + i * 18, 22 + i * 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  // --- layers -----------------------------------------------------------
  private decor: { x: number; y: number; r: number }[] = [];
  private decorKey = '';

  private buildDecor(s: GameState): void {
    const key = `${Math.round(this.view.minX)},${Math.round(this.view.maxX)},${Object.keys(s.facilities).length}`;
    if (key === this.decorKey) return;
    this.decorKey = key;
    // deterministic scatter (LCG) of trees/bushes in open ground
    const trees: { x: number; y: number; r: number }[] = [];
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const facs = Object.values(s.facilities);
    for (let i = 0; i < 130; i++) {
      const x = this.view.minX + rnd() * (this.view.maxX - this.view.minX);
      const y = this.view.minY + rnd() * (this.view.maxY - this.view.minY);
      let ok = true;
      for (const f of facs) {
        if (Math.abs(f.location.x - x) < 6 && Math.abs(f.location.y - y) < 6) { ok = false; break; }
      }
      if (ok) trees.push({ x, y, r: 0.9 + rnd() * 1.1 });
    }
    this.decor = trees;
  }

  private drawGround(s: GameState, _hour: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a1119';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const tl = this.w2s(s, { x: this.view.minX, y: this.view.minY });
    const br = this.w2s(s, { x: this.view.maxX, y: this.view.maxY });
    const gw = br.x - tl.x, gh = br.y - tl.y;
    const grad = ctx.createLinearGradient(0, tl.y, 0, br.y);
    grad.addColorStop(0, '#1c2e22');
    grad.addColorStop(1, '#15241d');
    ctx.fillStyle = grad;
    this.roundRectPathRaw(ctx, tl.x, tl.y, gw, gh, 14); ctx.fill();

    // zone tints (soft radial blobs)
    const zone = (wx: number, wy: number, rad: number, color: string) => {
      const c = this.w2s(s, { x: wx, y: wy });
      const rr = rad * this.effScale();
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rr);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill();
    };
    zone(40, 70, 36, 'rgba(70,120,80,0.18)');   // residential
    zone(55, 22, 40, 'rgba(150,110,60,0.16)');  // industrial
    zone(62, 46, 30, 'rgba(70,110,160,0.16)');  // commercial

    // trees / bushes
    this.buildDecor(s);
    ctx.save();
    ctx.beginPath(); this.roundRectPathRaw(ctx, tl.x, tl.y, gw, gh, 14); ctx.clip();
    for (const t of this.decor) {
      const p = this.w2s(s, t);
      const rr = Math.max(1.5, t.r * this.effScale() * 0.5);
      ctx.fillStyle = 'rgba(20,40,28,0.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y + rr * 0.4, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f6b40';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,200,140,0.35)';
      ctx.beginPath(); ctx.arc(p.x - rr * 0.3, p.y - rr * 0.3, rr * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // vignette for depth
    const vg = ctx.createRadialGradient(
      this.cssW / 2, this.cssH / 2, Math.min(this.cssW, this.cssH) * 0.3,
      this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.75,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  private drawRoads(s: GameState): void {
    const ctx = this.ctx;
    const sc = this.effScale();
    const roadW = Math.max(3, sc * 2.2);
    const { minX, minY, maxX, maxY } = this.view;
    const insetX = (maxX - minX) * 0.08, insetY = (maxY - minY) * 0.08;
    const x0 = minX + insetX, x1 = maxX - insetX, y0 = minY + insetY, y1 = maxY - insetY;
    const hYs = [y0, (y0 + y1) / 2, y1];
    const vXs = [x0, x0 + (x1 - x0) / 3, x0 + (2 * (x1 - x0)) / 3, x1];

    const road = (ax: number, ay: number, bx: number, by: number) => {
      const a = this.w2s(s, { x: ax, y: ay }), b = this.w2s(s, { x: bx, y: by });
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(33,40,53,0.95)'; ctx.lineWidth = roadW;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,160,180,0.30)'; ctx.lineWidth = Math.max(1, roadW * 0.1);
      ctx.setLineDash([7, 9]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    };
    // street grid
    for (const y of hYs) road(x0, y, x1, y);
    for (const x of vXs) road(x, y0, x, y1);

    // driveways: connect each building to the nearest horizontal avenue
    ctx.strokeStyle = 'rgba(33,40,53,0.9)'; ctx.lineWidth = Math.max(2, roadW * 0.6);
    ctx.lineCap = 'round';
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      let ny = hYs[0]!; for (const y of hYs) if (Math.abs(y - f.location.y) < Math.abs(ny - f.location.y)) ny = y;
      const a = this.w2s(s, f.location), bpt = this.w2s(s, { x: f.location.x, y: ny });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bpt.x, bpt.y); ctx.stroke();
    }
  }

  private drawFacilities(s: GameState, hour: number): void {
    const ctx = this.ctx;
    const selected = this.cb.getSelectedId();
    const night = Math.max(0, Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5 - 0.35);
    const order = Object.keys(s.facilities).sort((a, b) =>
      (s.facilities[a]!.type === 'home' ? 0 : 1) - (s.facilities[b]!.type === 'home' ? 0 : 1));
    for (const id of order) {
      const f = s.facilities[id]!;
      const p = this.drawPos(id, f.location);
      const sp = this.w2s(s, p);
      const isHome = f.type === 'home';
      const size = isHome ? 10 : 18;
      const player = f.ownerFirmId === s.playerFirmId;
      const sel = id === selected || id === this.hoverId;

      // drop shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y + size * 0.85, size * 0.95, size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (sel) {
        ctx.beginPath(); ctx.arc(sp.x, sp.y, size + 11, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(88,166,255,0.22)'; ctx.fill();
      }
      this.drawBuildingIcon(sp.x, sp.y, size, f.type, BUILDING_FILL[f.type], f.status === 'closed');
      // Upgrade pips: one gold dot per level above 1, along the icon's top edge.
      if (f.level > 1) {
        const ctx2 = this.ctx;
        ctx2.fillStyle = '#f0c040';
        for (let li = 0; li < f.level - 1; li++) {
          ctx2.beginPath();
          ctx2.arc(sp.x - size * 0.35 + li * size * 0.35, sp.y - size * 1.05, Math.max(1.4, size * 0.13), 0, Math.PI * 2);
          ctx2.fill();
        }
      }

      // lit windows at night (life after dark)
      if (night > 0.05 && f.status !== 'closed') {
        ctx.fillStyle = `rgba(255,214,120,${Math.min(0.9, night * 1.3)})`;
        const u = size / 10;
        const wins = isHome ? [[-3, 0]] : [[-5, 2], [0, 2], [5, 2]];
        for (const [wx, wy] of wins) ctx.fillRect(sp.x + wx! * u - u, sp.y + wy! * u, u * 1.8, u * 1.8);
      }

      if (player) {
        ctx.strokeStyle = '#f0c64c'; ctx.lineWidth = 2.5;
        this.roundRectPath(sp.x - size, sp.y - size, size * 2, size * 2, 6); ctx.stroke();
      }
      if (!isHome) {
        ctx.beginPath(); ctx.arc(sp.x + size - 2, sp.y - size + 2, 3.8, 0, Math.PI * 2);
        ctx.fillStyle = this.statusColor(f.status); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        // label with readable backdrop
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const tw = ctx.measureText(f.name).width;
        ctx.fillStyle = 'rgba(8,12,18,0.6)';
        this.roundRectPath(sp.x - tw / 2 - 4, sp.y + size + 2, tw + 8, 13, 3); ctx.fill();
        ctx.fillStyle = '#eaf1f8';
        ctx.fillText(f.name, sp.x, sp.y + size + 4);
      }
    }
  }

  private drawBuildingIcon(x: number, y: number, r: number, type: FacilityType, fill: string, closed: boolean): void {
    const ctx = this.ctx;
    ctx.globalAlpha = closed ? 0.45 : 1;
    // tile with top-light gradient + border + inner highlight
    const g = ctx.createLinearGradient(0, y - r, 0, y + r);
    g.addColorStop(0, this.lighten(fill, 0.22));
    g.addColorStop(1, this.lighten(fill, -0.14));
    ctx.fillStyle = g;
    this.roundRectPath(x - r, y - r, r * 2, r * 2, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
    this.roundRectPath(x - r, y - r, r * 2, r * 2, 6); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    this.roundRectPath(x - r + 1.5, y - r + 1.5, r * 2 - 3, r * 2 - 3, 5); ctx.stroke();

    ctx.fillStyle = 'rgba(10,15,20,0.72)';
    ctx.strokeStyle = 'rgba(10,15,20,0.72)';
    ctx.lineWidth = 2;
    const u = r / 10; // unit
    ctx.beginPath();
    switch (type) {
      case 'home': // roof triangle + door
        ctx.moveTo(x - 6 * u, y + 1 * u); ctx.lineTo(x, y - 6 * u); ctx.lineTo(x + 6 * u, y + 1 * u); ctx.closePath(); ctx.fill();
        ctx.fillRect(x - 1.5 * u, y + 1 * u, 3 * u, 5 * u);
        break;
      case 'farm': // wheat stalk
        ctx.lineWidth = 1.6; ctx.moveTo(x, y + 7 * u); ctx.lineTo(x, y - 6 * u); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const yy = y - 6 * u + i * 4 * u;
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 4 * u, yy - 2 * u); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 4 * u, yy - 2 * u); ctx.stroke();
        }
        break;
      case 'mine': // mountain + pick
        ctx.moveTo(x - 7 * u, y + 6 * u); ctx.lineTo(x - 1 * u, y - 6 * u); ctx.lineTo(x + 3 * u, y + 0 * u);
        ctx.lineTo(x + 5 * u, y - 3 * u); ctx.lineTo(x + 8 * u, y + 6 * u); ctx.closePath(); ctx.fill();
        break;
      case 'factory': // building + chimney + smoke
        ctx.fillRect(x - 7 * u, y - 1 * u, 9 * u, 7 * u);
        ctx.fillRect(x + 3 * u, y - 6 * u, 3 * u, 12 * u);
        ctx.globalAlpha = (closed ? 0.45 : 1) * 0.5;
        ctx.beginPath(); ctx.arc(x + 4.5 * u, y - 8 * u, 2 * u, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = closed ? 0.45 : 1;
        break;
      case 'warehouse': // box with band
        ctx.fillRect(x - 7 * u, y - 5 * u, 14 * u, 11 * u);
        ctx.fillStyle = fill; ctx.fillRect(x - 1.4 * u, y - 5 * u, 2.8 * u, 11 * u);
        break;
      case 'retail': // storefront + awning
        ctx.fillRect(x - 7 * u, y - 1 * u, 14 * u, 7 * u);
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = (closed ? 0.45 : 1) * 0.85;
        ctx.fillRect(x - 7 * u, y - 4 * u, 14 * u, 3 * u);
        ctx.globalAlpha = closed ? 0.45 : 1;
        break;
      case 'importer': // boat
        ctx.moveTo(x - 8 * u, y + 1 * u); ctx.lineTo(x + 8 * u, y + 1 * u); ctx.lineTo(x + 5 * u, y + 6 * u);
        ctx.lineTo(x - 5 * u, y + 6 * u); ctx.closePath(); ctx.fill();
        ctx.fillRect(x - 1 * u, y - 7 * u, 2 * u, 8 * u);
        break;
    }
    ctx.globalAlpha = 1;
  }

  private drawShipments(s: GameState, dt: number): void {
    const ctx = this.ctx;
    const k = Math.min(1, dt * 8);
    for (const id in s.vehicles) {
      const v = s.vehicles[id]!;
      if (v.status !== 'enroute') continue;
      const p = this.ease(id, v.currentLocation, k);
      const sp = this.w2s(s, p);
      const dest = this.w2s(s, v.targetLocation);
      // route line
      ctx.strokeStyle = 'rgba(210,168,255,0.30)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(dest.x, dest.y); ctx.stroke(); ctx.setLineDash([]);
      // truck
      const ang = Math.atan2(dest.y - sp.y, dest.x - sp.x);
      ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(ang);
      ctx.fillStyle = '#2b2f3a'; this.roundRectPathRaw(ctx, -7, -4, 14, 8, 2); ctx.fill();
      const col = this.productColor(v.cargo.productId);
      ctx.fillStyle = col; ctx.fillRect(-6, -3, 7, 6); // cargo
      ctx.fillStyle = '#11151c'; ctx.fillRect(2, -3, 4, 6); // cab
      ctx.restore();
    }
  }

  private drawCitizens(s: GameState, dt: number): void {
    const ctx = this.ctx;
    const selected = this.cb.getSelectedId();
    const k = Math.min(1, dt * 6);
    for (const id in s.citizens) {
      const c = s.citizens[id]!;
      const prev = this.smooth.get(id);
      const p = this.ease(id, c.currentLocation, k);
      const sp = this.w2s(s, p);
      // trail when moving
      if (prev && c.movementState === 'moving' && Math.random() < 0.25) {
        this.trails.push({ x: sp.x, y: sp.y, life: 0.5 });
      }
      const sel = id === selected;
      const col = ACTIVITY_COLOR[c.activity] ?? '#8b949e';
      const rad = sel ? 5 : 3.6;
      if (c.movementState === 'moving') {
        ctx.globalAlpha = 0.25; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, rad + 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(sp.x, sp.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.5)'; ctx.stroke();
    }
    // draw + decay trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]!; t.life -= dt;
      if (t.life <= 0) { this.trails.splice(i, 1); continue; }
      ctx.globalAlpha = t.life * 0.4;
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath(); ctx.arc(t.x, t.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.trails.length > 400) this.trails.splice(0, this.trails.length - 400);
  }

  // floaters: detect sales / deliveries / production via stat deltas
  private updateFloaters(s: GameState, dt: number): void {
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      const prev = this.prevStats.get(id) ?? { revenue: 0, received: 0, produced: 0 };
      const sp = this.w2s(s, this.drawPos(id, f.location));
      // a sale happened -> money rises from the store
      if (f.dailyStats.revenue > prev.revenue) {
        const delta = f.dailyStats.revenue - prev.revenue;
        this.spawnFloater(sp.x, sp.y - 16, `+${formatMoney(delta)}`, '#56d364');
      }
      // a delivery arrived -> goods badge
      if (f.dailyStats.unitsReceived > prev.received) {
        this.spawnFloater(sp.x, sp.y - 16, '+goods', '#d2a8ff');
      }
      // production completed -> small puff (only show occasionally to avoid spam)
      if (f.dailyStats.unitsProduced > prev.produced && Math.random() < 0.6) {
        this.spawnFloater(sp.x + 8, sp.y - 14, '+made', '#e0a458');
      }
      this.prevStats.set(id, {
        revenue: f.dailyStats.revenue,
        received: f.dailyStats.unitsReceived,
        produced: f.dailyStats.unitsProduced,
      });
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const fl = this.floaters[i]!;
      fl.life -= dt; fl.y += fl.vy * dt;
      if (fl.life <= 0) this.floaters.splice(i, 1);
    }
    if (this.floaters.length > 80) this.floaters.splice(0, this.floaters.length - 80);
  }

  private spawnFloater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 80) return;
    this.floaters.push({ x, y, vy: -22, life: 1.4, maxLife: 1.4, text, color });
  }

  private drawFloaters(): void {
    const ctx = this.ctx;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const fl of this.floaters) {
      const a = Math.min(1, fl.life / fl.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(fl.text, fl.x + 1, fl.y + 1);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawNightTint(hour: number): void {
    // 0 at noon, ~0.5 at midnight
    const night = Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5; // 0..1, peak at night
    const a = night * 0.42;
    if (a <= 0.01) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(6,12,30,${a})`;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  private drawHud(time: ReturnType<typeof computeTime>): void {
    const ctx = this.ctx;
    const people: { c: string; label: string }[] = [
      { c: ACTIVITY_COLOR.working, label: 'Working' },
      { c: ACTIVITY_COLOR.shopping, label: 'Shopping' },
      { c: ACTIVITY_COLOR['commuting-to-work'], label: 'Commuting' },
      { c: ACTIVITY_COLOR.home, label: 'At home' },
    ];
    const rows = LEGEND_BUILDINGS.length + people.length + 2; // +2 headers
    const panelH = rows * 14 + 14;
    const panelW = 116;
    const px = this.cssW - panelW - 12;
    let y = this.cssH - panelH - 12 + 14;
    ctx.fillStyle = 'rgba(13,17,23,0.78)';
    this.roundRectPath(px - 8, y - 14, panelW, panelH, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    this.roundRectPath(px - 8, y - 14, panelW, panelH, 7); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    ctx.fillStyle = '#6e7681'; ctx.font = '700 9px system-ui';
    ctx.fillText('BUILDINGS', px, y); y += 14;
    for (const item of LEGEND_BUILDINGS) {
      ctx.fillStyle = BUILDING_FILL[item.type];
      this.roundRectPath(px, y - 5, 10, 10, 2); ctx.fill();
      ctx.fillStyle = '#cdd9e5'; ctx.font = '10px system-ui';
      ctx.fillText(item.label, px + 16, y); y += 14;
    }
    ctx.fillStyle = '#6e7681'; ctx.font = '700 9px system-ui';
    ctx.fillText('PEOPLE', px, y); y += 14;
    for (const item of people) {
      ctx.fillStyle = item.c;
      ctx.beginPath(); ctx.arc(px + 5, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cdd9e5'; ctx.font = '10px system-ui';
      ctx.fillText(item.label, px + 16, y); y += 14;
    }

    // clock (top-left)
    ctx.fillStyle = 'rgba(13,17,23,0.78)';
    this.roundRectPath(10, 10, 140, 28, 7); ctx.fill();
    ctx.fillStyle = '#e6edf3'; ctx.font = '600 13px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const hh = String(time.hour).padStart(2, '0');
    const icon = time.hour >= 7 && time.hour < 19 ? '☀' : '☾';
    ctx.fillText(`${icon}  Day ${time.day + 1} · ${hh}:00`, 20, 25);
  }

  private drawHover(s: GameState): void {
    if (!this.mouse) { this.hoverId = null; return; }
    this.hoverId = this.pick(s, this.mouse);
    if (!this.hoverId || this.cb.getBuildMode()) return;
    const label = this.hoverLabel(s, this.hoverId);
    if (!label) return;
    const ctx = this.ctx;
    ctx.font = '600 11px system-ui';
    const w = ctx.measureText(label).width + 14;
    let x = this.mouse.x + 12;
    let y = this.mouse.y + 12;
    if (x + w > this.cssW) x = this.cssW - w - 4;
    ctx.fillStyle = 'rgba(1,4,9,0.92)';
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1;
    this.roundRectPath(x, y, w, 22, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 7, y + 11);
  }

  private hoverLabel(s: GameState, id: string): string | null {
    const f = s.facilities[id];
    if (f) return f.type === 'home' ? f.name : `${f.name} — ${f.status}`;
    const c = s.citizens[id];
    if (c) return `${c.name} — ${c.activity}`;
    const v = s.vehicles[id];
    if (v) return `Shipment: ${Math.floor(v.cargo.quantity)} ${getProduct(v.cargo.productId).name}`;
    return null;
  }

  // --- helpers ----------------------------------------------------------
  private lighten(hex: string, amt: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
    return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
  }
  private productColor(pid: string): string {
    switch (pid) {
      case 'grain': return '#d9b25a';
      case 'bread': return '#c98b3a';
      case 'minerals': return '#9aa7b5';
      case 'tools': return '#7fd1e0';
      default: return '#cccccc';
    }
  }
  private statusColor(status: string): string {
    switch (status) {
      case 'active': return '#3fb950';
      case 'closed': return '#f85149';
      case 'idle': return '#6e7681';
      default: return '#d29922';
    }
  }
  private roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    this.roundRectPathRaw(this.ctx, x, y, w, h, r);
  }
  private roundRectPathRaw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  resetView(): void { this.zoom = 1; this.panX = 0; this.panY = 0; this.autoFit = true; }
}
