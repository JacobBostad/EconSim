/**
 * sound.ts — tiny synthesized sound effects (WebAudio, no assets).
 *
 * All sounds are short, quiet stings synthesized on the fly: an achievement
 * chime, a mission "ka-ching", and world-news stings. A master mute persists
 * in localStorage. The AudioContext is created lazily on the first play after
 * a user gesture (browser autoplay policies), and every call is
 * failure-tolerant — sound is garnish, never a crash source.
 */

const MUTE_KEY = 'econsim.muted';

let ctx: AudioContext | null = null;
let muted: boolean = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx ?? new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx.state === 'closed' ? null : ctx;
  } catch {
    return null;
  }
}

/** One enveloped oscillator note. */
function note(
  ac: AudioContext,
  freq: number,
  startInMs: number,
  durMs: number,
  type: OscillatorType = 'sine',
  peak = 0.08,
): void {
  const t0 = ac.currentTime + startInMs / 1000;
  const t1 = t0 + durMs / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t1 + 0.05);
}

/** Achievement unlocked: a bright two-note bell. */
export function playAchievement(): void {
  const ac = audio();
  if (!ac) return;
  note(ac, 880, 0, 220, 'sine', 0.07);
  note(ac, 1318.5, 110, 320, 'sine', 0.06);
}

/** Mission reward: a quick "ka-ching". */
export function playMission(): void {
  const ac = audio();
  if (!ac) return;
  note(ac, 659.3, 0, 90, 'triangle', 0.07);
  note(ac, 987.8, 80, 100, 'triangle', 0.07);
  note(ac, 1760, 170, 260, 'sine', 0.05);
}

/** World news sting: bright for good news, low for bad, soft for neutral. */
export function playNews(kind: 'good' | 'bad' | 'neutral'): void {
  const ac = audio();
  if (!ac) return;
  if (kind === 'good') {
    note(ac, 523.3, 0, 140, 'triangle', 0.06);
    note(ac, 784, 120, 240, 'triangle', 0.055);
  } else if (kind === 'bad') {
    note(ac, 220, 0, 260, 'sawtooth', 0.045);
    note(ac, 174.6, 160, 340, 'sawtooth', 0.04);
  } else {
    note(ac, 440, 0, 180, 'sine', 0.045);
  }
}

/** Receivership: a slow, somber descent. */
export function playReceivership(): void {
  const ac = audio();
  if (!ac) return;
  note(ac, 196, 0, 380, 'sawtooth', 0.045);
  note(ac, 146.8, 300, 420, 'sawtooth', 0.04);
  note(ac, 110, 640, 700, 'sawtooth', 0.038);
}

/** Challenge finish: a four-note fanfare. */
export function playFanfare(): void {
  const ac = audio();
  if (!ac) return;
  note(ac, 523.3, 0, 150, 'triangle', 0.07);
  note(ac, 659.3, 130, 150, 'triangle', 0.07);
  note(ac, 784, 260, 150, 'triangle', 0.07);
  note(ac, 1046.5, 390, 450, 'sine', 0.065);
}

/** A rival opened something (roastery, residences): a soft build chime. */
export function playBuildChime(): void {
  const ac = audio();
  if (!ac) return;
  note(ac, 392, 0, 160, 'sine', 0.04);
  note(ac, 587.3, 140, 240, 'sine', 0.035);
}

/** One of your workers was poached: a sharp double tick. */
export function playPoachAlert(): void {
  const ac = audio();
  if (!ac) return;
  note(ac, 1244.5, 0, 70, 'square', 0.035);
  note(ac, 932.3, 90, 110, 'square', 0.035);
}
