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

  // --- camera -----------------------------------------------------------
  private baseScale(s: GameState): number {
    const margin = 40;
    return Math.min((this.cssW - margin) / s.config.mapWidth, (this.cssH - margin) / s.config.mapHeight);
  }
  private effScale(s: GameState): number { return this.baseScale(s) * this.zoom; }

  private w2s(s: GameState, p: Vec): Vec {
    const sc = this.effScale(s);
    return {
      x: this.cssW / 2 + this.panX + (p.x - s.config.mapWidth / 2) * sc,
      y: this.cssH / 2 + this.panY + (p.y - s.config.mapHeight / 2) * sc,
    };
  }
  private s2w(s: GameState, p: Vec): Vec {
    const sc = this.effScale(s);
    return {
      x: s.config.mapWidth / 2 + (p.x - this.cssW / 2 - this.panX) / sc,
      y: s.config.mapHeight / 2 + (p.y - this.cssH / 2 - this.panY) / sc,
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
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.autoFit) { this.panX = 0; this.panY = 0; }

    const time = computeTime(s.tick, s.config);
    this.drawGround(s, time.hour);
    this.drawRoads(s);
    this.drawFacilities(s);
    this.drawShipments(s, dt);
    this.drawCitizens(s, dt);
    this.updateFloaters(s, dt);
    this.drawFloaters();
    this.drawNightTint(time.hour);
    this.drawHud(time);
    this.drawHover(s);
  }

  // --- layers -----------------------------------------------------------
  private drawGround(s: GameState, _hour: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0b1622';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    // grassy play area
    const tl = this.w2s(s, { x: 0, y: 0 });
    const br = this.w2s(s, { x: s.config.mapWidth, y: s.config.mapHeight });
    const grad = ctx.createLinearGradient(0, tl.y, 0, br.y);
    grad.addColorStop(0, '#16241c');
    grad.addColorStop(1, '#12201b');
    ctx.fillStyle = grad;
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    // subtle field texture
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    const step = 10;
    for (let x = 0; x <= s.config.mapWidth; x += step) {
      const a = this.w2s(s, { x, y: 0 }); const b = this.w2s(s, { x, y: s.config.mapHeight });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let y = 0; y <= s.config.mapHeight; y += step) {
      const a = this.w2s(s, { x: 0, y }); const b = this.w2s(s, { x: s.config.mapWidth, y });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  private drawRoads(s: GameState): void {
    const ctx = this.ctx;
    const hub = this.w2s(s, { x: s.config.mapWidth / 2, y: s.config.mapHeight / 2 });
    const roadW = Math.max(3, this.effScale(s) * 1.6);
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      const p = this.w2s(s, f.location);
      ctx.strokeStyle = 'rgba(40,48,62,0.9)';
      ctx.lineWidth = roadW;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,130,150,0.25)';
      ctx.lineWidth = Math.max(1, roadW * 0.12);
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // town square
    ctx.fillStyle = 'rgba(60,70,90,0.5)';
    ctx.beginPath(); ctx.arc(hub.x, hub.y, roadW * 1.4, 0, Math.PI * 2); ctx.fill();
  }

  private drawFacilities(s: GameState): void {
    const ctx = this.ctx;
    const selected = this.cb.getSelectedId();
    // homes first (background), then operating facilities
    const order = Object.keys(s.facilities).sort((a, b) =>
      (s.facilities[a]!.type === 'home' ? 0 : 1) - (s.facilities[b]!.type === 'home' ? 0 : 1));
    for (const id of order) {
      const f = s.facilities[id]!;
      const p = this.drawPos(id, f.location);
      const sp = this.w2s(s, p);
      const isHome = f.type === 'home';
      const size = isHome ? 9 : 17;
      const player = f.ownerFirmId === s.playerFirmId;
      const sel = id === selected || id === this.hoverId;

      if (sel) {
        ctx.beginPath(); ctx.arc(sp.x, sp.y, size + 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(88,166,255,0.18)'; ctx.fill();
      }
      this.drawBuildingIcon(sp.x, sp.y, size, f.type, BUILDING_FILL[f.type], f.status === 'closed');

      if (player) {
        ctx.strokeStyle = '#f0c64c'; ctx.lineWidth = 2.5;
        this.roundRectPath(sp.x - size, sp.y - size, size * 2, size * 2, 5); ctx.stroke();
      }
      if (!isHome) {
        // status dot
        ctx.beginPath(); ctx.arc(sp.x + size - 2, sp.y - size + 2, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = this.statusColor(f.status); ctx.fill();
        // label
        ctx.fillStyle = 'rgba(230,237,243,0.92)';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(f.name, sp.x, sp.y + size + 3);
      }
    }
  }

  private drawBuildingIcon(x: number, y: number, r: number, type: FacilityType, fill: string, closed: boolean): void {
    const ctx = this.ctx;
    ctx.globalAlpha = closed ? 0.45 : 1;
    // base lot
    ctx.fillStyle = fill;
    this.roundRectPath(x - r, y - r, r * 2, r * 2, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    this.roundRectPath(x - r, y - r, r * 2, r * 2, 5); ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
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
      ctx.beginPath(); ctx.arc(sp.x, sp.y, sel ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = ACTIVITY_COLOR[c.activity] ?? '#8b949e'; ctx.fill();
      if (sel) { ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
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
    // legend (bottom-left)
    const lx = 12; let ly = this.cssH - 14 - LEGEND_BUILDINGS.length * 15;
    ctx.fillStyle = 'rgba(13,17,23,0.72)';
    this.roundRectPath(lx - 8, ly - 22, 132, LEGEND_BUILDINGS.length * 15 + 30, 6); ctx.fill();
    ctx.font = '700 9px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8b949e';
    ctx.fillText('LEGEND', lx, ly - 12);
    for (const item of LEGEND_BUILDINGS) {
      ctx.fillStyle = BUILDING_FILL[item.type];
      this.roundRectPath(lx, ly - 5, 10, 10, 2); ctx.fill();
      ctx.fillStyle = '#cdd9e5'; ctx.font = '10px system-ui';
      ctx.fillText(item.label, lx + 16, ly);
      ly += 15;
    }
    // clock (top-left)
    ctx.fillStyle = 'rgba(13,17,23,0.72)';
    this.roundRectPath(10, 10, 132, 26, 6); ctx.fill();
    ctx.fillStyle = '#e6edf3'; ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle';
    const hh = String(time.hour).padStart(2, '0');
    const icon = time.hour >= 7 && time.hour < 19 ? '☀' : '☾';
    ctx.fillText(`${icon}  Day ${time.day + 1} · ${hh}:00`, 18, 24);
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
