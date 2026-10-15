/*
 * audio.js – Soundeffekte und Musik per WebAudio (keine Audiodateien).
 * PLATZHALTER-Version: stellt die API bereit; wird durch die volle Version ersetzt.
 *
 * API:
 *   SS.Audio.unlock()            – AudioContext nach Nutzer-Geste starten
 *   SS.Audio.sfx(name)           – 'jump','coin','death','checkpoint','portal','pad','orb',
 *                                  'click','success','fail','error','type','water','buzz','tick','win','lose'
 *   SS.Audio.music.play(track)   – 'menu','run','klausur','boss','sidequest'
 *   SS.Audio.music.stop()
 *   SS.Audio.toggleMute() / setMuted(bool) / isMuted()
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  const MUTE_KEY = SS.CONFIG.STORAGE_KEY + '.muted';

  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = globalThis.localStorage && localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }

  function ensureContext() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(freq, duration, type, volume, slideTo) {
    const ac = ensureContext();
    if (!ac || muted) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(volume || 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const SFX = {
    jump: () => tone(420, 0.12, 'square', 0.12, 720),
    coin: () => { tone(988, 0.08, 'square', 0.12); setTimeout(() => tone(1319, 0.12, 'square', 0.12), 70); },
    death: () => tone(220, 0.4, 'sawtooth', 0.2, 55),
    checkpoint: () => { tone(660, 0.1, 'triangle', 0.2); setTimeout(() => tone(990, 0.2, 'triangle', 0.2), 100); },
    portal: () => tone(300, 0.3, 'sine', 0.2, 900),
    pad: () => tone(500, 0.15, 'square', 0.15, 1200),
    orb: () => tone(700, 0.12, 'triangle', 0.15, 1100),
    click: () => tone(880, 0.05, 'square', 0.08),
    success: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.18), i * 90)),
    fail: () => [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sawtooth', 0.15), i * 140)),
    error: () => tone(160, 0.25, 'square', 0.15),
    type: () => tone(1200 + Math.random() * 300, 0.03, 'square', 0.04),
    water: () => tone(300 + Math.random() * 200, 0.06, 'sine', 0.08, 200),
    buzz: () => tone(110, 0.3, 'sawtooth', 0.12),
    tick: () => tone(1500, 0.03, 'square', 0.05),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.2), i * 110)),
    lose: () => [330, 311, 294, 262].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.15), i * 220))
  };

  const Audio = {
    unlock() {
      const ac = ensureContext();
      if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    },
    sfx(name) {
      try { if (SFX[name]) SFX[name](); } catch (e) { /* Audio darf das Spiel nie abstürzen lassen */ }
    },
    music: {
      current: null,
      play(track) { this.current = track; },
      stop() { this.current = null; }
    },
    isMuted: () => muted,
    setMuted(value) {
      muted = !!value;
      try { if (globalThis.localStorage) localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* egal */ }
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    toggleMute() { return this.setMuted(!muted); }
  };

  SS.Audio = Audio;
})();
