import { describe, it, expect } from 'vitest';
import { isMusicOn, setMusicOn, setMusicMood, startMusic, stopMusic } from '../../ui/music';

describe('Ambient music module', () => {
  it('no-ops safely without a DOM or AudioContext (node env)', () => {
    expect(() => {
      startMusic();
      setMusicMood('night');
      setMusicMood('day');
      stopMusic();
    }).not.toThrow();
  });

  it('the on/off toggle round-trips even without localStorage', () => {
    const before = isMusicOn();
    setMusicOn(false);
    expect(isMusicOn()).toBe(false);
    setMusicOn(true);
    expect(isMusicOn()).toBe(true);
    setMusicOn(before);
  });
});
