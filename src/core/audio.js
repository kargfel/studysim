/*
 * audio.js – Soundeffekte und Musik per WebAudio, komplett synthetisiert (keine Audiodateien).
 *
 * API (alle Szenen nutzen sie – bitte kompatibel halten):
 *   SS.Audio.unlock()            – AudioContext nach einer Nutzer-Geste starten (main.js ruft das auf)
 *   SS.Audio.sfx(name)           – 'jump','coin','death','checkpoint','portal','pad','orb',
 *                                  'click','success','fail','error','type','water','buzz','tick','win','lose'
 *                                  (unbekannte Namen bleiben still)
 *   SS.Audio.music.play(track)   – 'menu','run','klausur','boss','sidequest' (gleicher Track = nichts tun)
 *   SS.Audio.music.stop()        – Musik ausblenden
 *   SS.Audio.music.current       – gewünschter Track oder null (nur lesen)
 *   SS.Audio.toggleMute() / setMuted(bool) / isMuted()  – Stummschaltung (wird gespeichert)
 *   SS.Audio.status()            – Debug-Info für Konsole und Tests
 *
 * Aufbau der Datei:
 *   1. Konstanten                 5. Audio-Graph: Kontext, Master, Busse
 *   2. Klangfarben                6. Synth-Bausteine: Ton, Rauschen, Schlagzeug
 *   3. Musik (Pattern-Daten)      7. Sequencer mit Lookahead-Scheduling
 *   4. Soundeffekte               8. Stummschalten, Tab-Wechsel, öffentliche API
 *
 * Ohne WebAudio (Node-Tests, alte Browser) ist alles ein No-Op, und kein Fehler
 * verlässt dieses Modul – Audio darf das Spiel nie abstürzen lassen.
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});

  // ═══ 1. Konstanten ══════════════════════════════════════════════════

  const MUTE_KEY = ((SS.CONFIG && SS.CONFIG.STORAGE_KEY) || 'studiums-simulator') + '.muted';

  const VOLUME = {
    master: 0.8,  // Gesamtlautstärke (bei Stummschaltung 0)
    music: 0.25,  // Musik-Bus – deutlich leiser als die Effekte
    sfx: 0.8      // Effekt-Bus
  };

  const FADE = {
    in: 0.25,     // s: neuen Track einblenden (nur beim Wechsel – aus der Stille startet er sofort)
    out: 0.5,     // s: alten Track ausblenden (Wechsel oder stop())
    mute: 0.015   // s: Zeitkonstante beim Stummschalten (verhindert Knacken)
  };

  const SCHEDULER = {
    intervalMs: 25,     // so oft wacht der Scheduler auf (setInterval)
    aheadS: 0.12,       // so weit im Voraus werden Noten fest eingeplant
    startDelayS: 0.05,  // Vorlauf bis zum ersten Ton eines neuen Tracks
    maxLagS: 0.1        // hing der Browser länger, werden verpasste Noten übersprungen
  };

  const STEPS_PER_BAR = 16;     // 16tel-Raster: 16 Schritte pro 4/4-Takt
  const FILL_EVERY_BARS = 4;    // jeder 4. Takt spielt das Fill-Schlagzeug
  const BPM_RANGE = [40, 300];  // Schutz vor Endlosschleifen bei Tippfehlern im Tempo
  const SFX_MIN_GAP_S = 0.03;   // derselbe Effekt höchstens alle 30 ms (z. B. Tippen)
  const SFX_OFFSET_S = 0.005;   // kleiner Vorlauf, damit jeder Effekt sauber beginnt

  // ═══ 2. Klangfarben ═════════════════════════════════════════════════

  // Hüllkurven (ADSR): attack/decay/release in Sekunden, sustain als Anteil der Spitze
  const ENV = {
    hit:   { attack: 0.001, decay: 0.08, sustain: 0,    release: 0.04 },  // Klicks, Ticken, Hi-Hat
    blip:  { attack: 0.002, decay: 0.05, sustain: 0.5,  release: 0.04 },  // kurze 8-Bit-Töne
    ding:  { attack: 0.002, decay: 0.2,  sustain: 0,    release: 0.15 },  // klingt aus wie eine Glocke
    note:  { attack: 0.005, decay: 0.1,  sustain: 0.75, release: 0.08 },  // gehaltene Töne
    swell: { attack: 0.12,  decay: 0.1,  sustain: 0.8,  release: 0.15 },  // anschwellend (Portal)
    crash: { attack: 0.002, decay: 0.25, sustain: 0.25, release: 0.3 },   // Aufprall
    kick:  { attack: 0.001, decay: 0.25, sustain: 0,    release: 0.06 },
    snare: { attack: 0.001, decay: 0.12, sustain: 0,    release: 0.05 }
  };

  // Instrumente der Musik. gate = Anteil der Notenlänge, den der Ton gehalten wird.
  const INSTRUMENTS = {
    bassTri:  { wave: 'triangle', vol: 0.5,  gate: 0.85, env: { attack: 0.004, decay: 0.15, sustain: 0.7,  release: 0.05 } },
    bassSaw:  { wave: 'sawtooth', vol: 0.28, gate: 0.6,  env: { attack: 0.003, decay: 0.12, sustain: 0.5,  release: 0.04 },
                filter: { type: 'lowpass', freq: 1500, to: 240, q: 5 } },
    pluck:    { wave: 'pulse25',  vol: 0.1,  gate: 0.5,  env: { attack: 0.002, decay: 0.09, sustain: 0.1,  release: 0.04 } },
    bell:     { wave: 'triangle', vol: 0.2,  gate: 1,    env: { attack: 0.002, decay: 0.3,  sustain: 0,    release: 0.3 } },
    lead:     { wave: 'pulse25',  vol: 0.13, gate: 0.9,  env: { attack: 0.004, decay: 0.12, sustain: 0.65, release: 0.06 } },
    leadSoft: { wave: 'triangle', vol: 0.22, gate: 0.95, env: { attack: 0.02,  decay: 0.2,  sustain: 0.6,  release: 0.2 },
                vibrato: { rate: 5, depth: 12 } },
    leadSaw:  { wave: 'sawtooth', vol: 0.1,  gate: 0.95, env: { attack: 0.01,  decay: 0.2,  sustain: 0.7,  release: 0.1 },
                filter: { type: 'lowpass', freq: 2600, q: 2 }, vibrato: { rate: 5.5, depth: 15 } },
    pizz:     { wave: 'pulse12',  vol: 0.14, gate: 0.5,  env: { attack: 0.002, decay: 0.08, sustain: 0.15, release: 0.05 } }
  };

  // Schlagzeug: Grundlautstärke je Spur und Anschlagstärke je Zeichen
  const DRUM_VOLUME = { kick: 0.7, snare: 0.38, hat: 0.15 };
  const VELOCITY = { X: 1, x: 0.65, o: 0.65 };  // 'X' betont, 'x' normal, 'o' offene Hi-Hat

  // ═══ 3. Musik: Pattern-Daten ════════════════════════════════════════
  // Notation – jedes Zeichen (bzw. jedes durch Leerzeichen getrennte Wort) ist ein 16tel:
  //   '.' = Pause, '-' = vorherigen Ton weiter halten
  //   drums:    'X' = betonter Schlag, 'x' = Schlag, 'o' = offene Hi-Hat
  //   bass/arp: Ziffer = Akkordton von unten (0 Grundton, 1 Terz, 2 Quinte, 3 Oktave, 4 Terz darüber …);
  //             low = tiefster erlaubter Grundton, legt also die Tonlage fest
  //   lead:     Notennamen wie 'E5' oder 'G#4', ein String pro Takt; null = Takt ohne Melodie
  // chords: ein Akkord pro Takt ('Am' = a-Moll, 'F' = F-Dur, 'Bdim' = vermindert).
  // Die Schleife ist so lang wie die längere Liste (chords oder lead.bars).
  // fill: ersetzt einzelne Schlagzeugspuren in jedem 4. Takt (Wirbel vor dem Neuanfang).
  // pump: Sidechain-Effekt wie im EDM – die übrigen Stimmen ducken sich bei jeder Bassdrum.
  const TRACKS = {
    // Hauptmenü: entspannt und leicht geswingt, ab Takt 5 mit Melodie
    menu: {
      bpm: 100, swing: 0.12, volume: 0.85,
      chords: ['F', 'G', 'Em', 'Am'],
      bass: { sound: 'bassTri', low: 'E2', steps: '0--.....0-.2-.3.' },
      arp:  { sound: 'bell',    low: 'E3', steps: '0.2.3.2.1...3.4.' },
      lead: { sound: 'leadSoft', bars: [
        null, null, null, null,
        'A4 -  -  -  C5 -  -  -  .  .  F5 -  E5 -  C5 -',
        'D5 -  -  -  -  -  B4 -  -  -  G4 -  -  -  .  .',
        'B4 -  -  -  E5 -  -  -  G5 -  -  -  D5 -  -  -',
        'C5 -  -  -  -  -  -  -  .  .  .  .  .  .  .  .'
      ] },
      drums: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: '..x...x...x...x.' }
    },

    // Runner: treibend – Oktav-Bass, 16tel-Arpeggio, Four-on-the-floor; Melodie ab Takt 5
    run: {
      bpm: 128, volume: 1, pump: 0.45,
      chords: ['Am', 'F', 'C', 'G'],
      bass: { sound: 'bassSaw', low: 'E2', steps: '0.3.0.3.0.3.0.3.' },
      arp:  { sound: 'pluck',   low: 'F3', steps: '0123012301230123' },
      lead: { sound: 'lead', bars: [
        null, null, null, null,
        'E5 .  E5 .  A5 .  E5 .  G5 -  E5 .  D5 .  C5 .',
        'C5 .  C5 .  F5 .  C5 .  E5 -  C5 .  A4 .  C5 .',
        'G4 .  C5 .  E5 .  G5 .  A5 -  G5 .  E5 .  C5 .',
        'D5 -  -  .  B4 -  -  .  G4 .  A4 .  B4 .  D5 .'
      ] },
      drums: { kick: 'X...x...X...x...', snare: '....X.......X...', hat: '.xox.xox.xox.xox' },
      fill:  { snare: '....X.......XxXX' }
    },

    // Klausur: schnell, Moll, tickend – Bass und Arpeggio greifen im 16tel ineinander
    klausur: {
      bpm: 150, volume: 0.8,
      chords: ['Em', 'Em', 'C', 'B', 'Am', 'Em', 'C', 'B'],
      bass: { sound: 'bassSaw', low: 'E2', steps: '0.0.0.0.0.0.0.0.' },
      arp:  { sound: 'pluck',   low: 'G3', steps: '.3.2.3.2.3.2.3.2' },
      drums: { kick: 'X.....x.X.....x.', snare: '....x.......x...', hat: 'X.x.X.x.X.x.X.x.' },
      fill:  { snare: '....x.......xxxx' }
    },

    // Endboss (mündliche Prüfung): dramatisch – galoppierender Bass, Sägezahn-Melodie ab Takt 5
    boss: {
      bpm: 140, volume: 1, pump: 0.3,
      chords: ['Am', 'F', 'Dm', 'E'],
      bass: { sound: 'bassSaw', low: 'E2', steps: '0.000.000.000.00' },
      arp:  { sound: 'pluck',   low: 'F3', steps: '3.2.1.2.3.2.1.2.' },
      lead: { sound: 'leadSaw', bars: [
        null, null, null, null,
        'A4 -  -  -  C5 -  -  -  E5 -  -  -  A5 -  G5 -',
        'F5 -  -  -  E5 -  -  -  C5 -  -  -  A4 -  -  -',
        'D5 -  -  -  F5 -  -  -  A5 -  -  -  G5 -  F5 -',
        'E5 -  -  -  -  -  -  -  G#5 - -  -  B5 -  -  -'
      ] },
      drums: { kick: 'X.x...x.X.x...x.', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      fill:  { snare: '....X...X.XXXXXX' }
    },

    // Side Quests: verspielt und leise – Swing, Pizzicato-Melodie, wenig Schlagzeug
    sidequest: {
      bpm: 116, swing: 0.16, volume: 0.6,
      chords: ['C', 'Am', 'F', 'G'],
      bass: { sound: 'bassTri', low: 'E2', steps: '0...2.0.0...2.3.' },
      lead: { sound: 'pizz', bars: [
        'C5 .  E5 .  G5 .  E5 .  C5 .  .  .  G4 .  .  .',
        'A4 .  C5 .  E5 .  C5 .  A4 .  .  .  E5 .  .  .',
        'F4 .  A4 .  C5 .  F5 .  E5 .  D5 .  C5 .  .  .',
        'D5 .  .  B4 .  .  G4 .  A4 .  B4 .  D5 .  .  .',
        'E5 .  G5 .  C6 .  G5 .  E5 .  .  .  C5 .  .  .',
        'C5 .  E5 .  A5 .  E5 .  C5 .  .  .  A4 .  .  .',
        'A4 .  C5 .  F5 .  A5 .  G5 .  F5 .  E5 .  .  .',
        'D5 .  G5 .  B5 .  G5 .  D5 .  .  .  .  .  .  .'
      ] },
      drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.' }
    }
  };

  // ═══ 4. Soundeffekte ════════════════════════════════════════════════
  // Jedes Rezept bekommt die Startzeit t (Kontextzeit) und plant alle Töne exakt
  // auf der Audio-Uhr – ohne setTimeout, deshalb gibt es nichts aufzuräumen.
  const SFX = {
    // ── Runner ──
    jump(t) {
      tone({ wave: 'pulse25', freq: 280, to: 620, slide: 0.07, at: t, dur: 0.06, vol: 0.2, env: ENV.blip });
    },
    coin(t) {
      tone({ wave: 'pulse25', freq: hz('B5'), at: t, dur: 0.05, vol: 0.22, env: ENV.blip });
      tone({ wave: 'pulse25', freq: hz('E6'), at: t + 0.06, dur: 0.22, vol: 0.22, env: ENV.ding });
    },
    death(t) {
      // Crash: Rauschen hinter einem zufallenden Tiefpass, abstürzender Sägezahn, dumpfer Wumms
      noise({ at: t, dur: 0.25, vol: 0.4, env: ENV.crash, filter: { type: 'lowpass', freq: 7000, to: 180 } });
      tone({ wave: 'sawtooth', freq: 520, to: 45, slide: 0.45, at: t, dur: 0.35, vol: 0.22, env: ENV.crash });
      tone({ wave: 'sine', freq: 120, to: 35, slide: 0.25, at: t, dur: 0.2, vol: 0.38, env: ENV.kick });
    },
    checkpoint(t) {
      melody(['C5', 'E5', 'G5', 'C6'], t, 0.06, { wave: 'pulse25', dur: 0.05, vol: 0.15, env: ENV.blip });
      chord(['C6', 'G6'], t + 0.24, { wave: 'triangle', dur: 0.3, vol: 0.14, env: ENV.ding });
      noise({ at: t + 0.24, dur: 0.15, vol: 0.05, env: ENV.ding, filter: { type: 'highpass', freq: 8000 } });
    },
    portal(t) {
      // Schwerkraft-Portal: anschwellendes Zischen plus „eiernder“ Sinus-Sweep
      noise({ at: t, dur: 0.25, vol: 0.28, env: ENV.swell, filter: { type: 'bandpass', freq: 300, to: 4000, q: 5 } });
      tone({ wave: 'sine', freq: 160, to: 1200, slide: 0.3, at: t, dur: 0.25, vol: 0.18, env: ENV.swell,
             vibrato: { rate: 18, depth: 60 } });
    },
    pad(t) {
      // Sprungfeder: „Boing“ mit schnellem Pitch-Anstieg
      tone({ wave: 'square', freq: 150, to: 900, slide: 0.11, at: t, dur: 0.1, vol: 0.14, env: ENV.blip });
      tone({ wave: 'triangle', freq: 75, to: 450, slide: 0.11, at: t, dur: 0.12, vol: 0.3, env: ENV.blip });
    },
    orb(t) {
      tone({ wave: 'triangle', freq: 700, to: 1400, slide: 0.05, at: t, dur: 0.06, vol: 0.24, env: ENV.blip });
      tone({ wave: 'sine', freq: 2100, at: t + 0.03, dur: 0.1, vol: 0.08, env: ENV.ding });
    },

    // ── Oberfläche ──
    click(t) {
      tone({ wave: 'square', freq: 1500, to: 1000, slide: 0.025, at: t, dur: 0.02, vol: 0.12, env: ENV.hit });
    },
    success(t) {
      melody(['C5', 'E5', 'G5'], t, 0.07, { wave: 'pulse25', dur: 0.06, vol: 0.15, env: ENV.blip });
      chord(['C6', 'E6'], t + 0.21, { wave: 'triangle', dur: 0.25, vol: 0.16, env: ENV.ding });
      chord(['G5'], t + 0.21, { wave: 'pulse25', dur: 0.25, vol: 0.06, env: ENV.ding });
    },
    fail(t) {
      // „Durchgefallen“: zwei Schritte abwärts, der letzte Ton rutscht wackelnd ab
      const sad = { wave: 'sawtooth', dur: 0.12, vol: 0.16, env: ENV.note, filter: { type: 'lowpass', freq: 1800 } };
      melody(['E4', 'D#4'], t, 0.16, sad);
      tone({ ...sad, freq: hz('D4'), to: hz('A3'), slide: 0.45, at: t + 0.32, dur: 0.4, vibrato: { rate: 7, depth: 30 } });
    },
    error(t) {
      // Doppeltes „Möp“
      const nope = { wave: 'square', freq: 155, dur: 0.06, vol: 0.18, env: ENV.blip, filter: { type: 'lowpass', freq: 1400 } };
      tone({ ...nope, at: t });
      tone({ ...nope, at: t + 0.1 });
    },
    type(t) {
      // Tastenanschlag: kurzes Klick-Rauschen, jedes Mal etwas anders
      const click = { type: 'bandpass', freq: 2000 + Math.random() * 2500, q: 1.5 };
      noise({ at: t, dur: 0.01, vol: 0.2, env: ENV.hit, filter: click });
      tone({ wave: 'square', freq: 1600 + Math.random() * 800, at: t, dur: 0.006, vol: 0.025, env: ENV.hit });
    },
    water(t) {
      // Blubb: Luftblase (Sinus mit steigender Tonhöhe) plus leises Plätschern
      const base = 240 + Math.random() * 240;
      tone({ wave: 'sine', freq: base, to: base * 2.8, slide: 0.07, at: t, dur: 0.05, vol: 0.3, env: ENV.blip });
      const splash = { type: 'bandpass', freq: 900 + Math.random() * 600, q: 3 };
      noise({ at: t, dur: 0.08, vol: 0.07, env: ENV.ding, filter: splash });
    },
    buzz(t) {
      // Quiz-Summer: zwei leicht verstimmte tiefe Töne erzeugen eine raue Schwebung
      const buzzer = { at: t, dur: 0.3, env: ENV.note, filter: { type: 'lowpass', freq: 2000 } };
      tone({ ...buzzer, wave: 'sawtooth', freq: 92, vol: 0.2 });
      tone({ ...buzzer, wave: 'square', freq: 97, vol: 0.12 });
    },
    tick(t) {
      tone({ wave: 'triangle', freq: 2200, to: 1600, slide: 0.02, at: t, dur: 0.012, vol: 0.2, env: ENV.hit });
      noise({ at: t, dur: 0.008, vol: 0.05, env: ENV.hit, filter: { type: 'highpass', freq: 6000 } });
    },
    win(t) {
      // Abschluss-Fanfare: Aufgang, gehaltener Dur-Akkord mit Bass und Becken
      melody(['G4', 'C5', 'E5', 'G5'], t, 0.09, { wave: 'pulse25', dur: 0.08, vol: 0.15, env: ENV.blip });
      chord(['C5', 'E5', 'G5', 'C6'], t + 0.4, {
        wave: 'pulse25', dur: 0.8, vol: 0.06, env: ENV.note, vibrato: { rate: 6, depth: 10 }
      });
      tone({ wave: 'triangle', freq: hz('C3'), at: t + 0.4, dur: 0.8, vol: 0.2, env: ENV.note });
      noise({ at: t + 0.4, dur: 0.3, vol: 0.1, env: ENV.crash, filter: { type: 'highpass', freq: 6000 } });
    },
    lose(t) {
      // Exmatrikuliert: langsamer chromatischer Abstieg, der letzte Ton sinkt mit Vibrato
      const sad = { wave: 'square', dur: 0.24, vol: 0.16, env: ENV.note, filter: { type: 'lowpass', freq: 1600 } };
      melody(['G4', 'F#4', 'F4'], t, 0.3, sad);
      tone({ ...sad, freq: hz('E4'), to: hz('C4'), slide: 0.9, at: t + 0.9, dur: 0.8, vibrato: { rate: 6, depth: 35 } });
    }
  };

  // ═══ 5. Audio-Graph ═════════════════════════════════════════════════
  //   Ton/Rauschen ─► sfxBus ───────────────┐
  //   Track-Gain (Fades) ─► musicBus ───────┼─► master (Mute) ─► Limiter ─► Lautsprecher
  const engine = {
    ctx: null,          // AudioContext – erst nach der ersten Nutzer-Geste (unlock)
    failed: false,      // true, wenn WebAudio fehlt oder nicht startet → dauerhaft still
    master: null,
    musicBus: null,
    sfxBus: null,
    noiseBuffer: null,  // 1 s weißes Rauschen, Quelle für alle Rausch-Klänge
    waves: {},          // Cache für Pulswellen (Tastgrad → PeriodicWave)
    primed: false       // stummer Mini-Puffer schon gespielt? (entsperrt iOS)
  };

  let muted = loadMuted();
  let pausedByVisibility = false;  // Kontext angehalten, weil der Tab versteckt ist
  const lastPlayedAt = {};         // Effekt-Name → letzte Startzeit (gegen Dauerfeuer)

  /** Legt beim ersten Aufruf Kontext und Busse an; liefert null, wenn es kein WebAudio gibt. */
  function createEngine() {
    if (engine.ctx || engine.failed) return engine.ctx;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      engine.failed = true;
      return null;
    }
    try {
      const ctx = new AudioContextClass();
      const limiter = ctx.createDynamicsCompressor();  // fängt Spitzen ab, wenn viel gleichzeitig klingt
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.connect(ctx.destination);
      engine.master = createGain(ctx, muted ? 0 : VOLUME.master, limiter);
      engine.musicBus = createGain(ctx, VOLUME.music, engine.master);
      engine.sfxBus = createGain(ctx, VOLUME.sfx, engine.master);
      engine.noiseBuffer = createNoiseBuffer(ctx);
      ctx.onstatechange = guard(onContextStateChange);
      engine.ctx = ctx;
    } catch (error) {
      engine.failed = true;
      warnOnce(error);
    }
    return engine.ctx;
  }

  function createGain(ctx, value, destination) {
    const gain = ctx.createGain();
    gain.gain.value = value;
    gain.connect(destination);
    return gain;
  }

  function createNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);  // 1 s, mono
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Ein stummer Mini-Puffer innerhalb der Nutzer-Geste entsperrt die Ausgabe (v. a. iOS Safari). */
  function playSilence(ctx) {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  }

  function isRunning() {
    return !!engine.ctx && engine.ctx.state === 'running' && !pausedByVisibility;
  }

  /** Effekte dürfen auch bei noch startendem Kontext eingeplant werden – nur nicht im versteckten Tab. */
  function canPlaySfx() {
    return !!engine.ctx && engine.ctx.state !== 'closed' && !pausedByVisibility;
  }

  function onContextStateChange() {
    if (isRunning()) syncMusic();  // z. B. Track, der vor der ersten Nutzer-Geste gewünscht wurde
  }

  // ═══ 6. Synth-Bausteine ═════════════════════════════════════════════

  /**
   * Ein Oszillator-Ton mit Hüllkurve – der wichtigste Baustein.
   *   freq, to, slide – Start-/Zielfrequenz in Hz und Dauer des Pitch-Slides (Standard: dur)
   *   wave    – 'square', 'sawtooth', 'triangle', 'sine', 'pulse25', 'pulse12'
   *   at, dur – Startzeit (Kontextzeit) und Haltedauer in Sekunden
   *   vol, env – Spitzenlautstärke und Hüllkurve (siehe ENV)
   *   filter  – optional {type, freq, to, q}; vibrato – optional {rate in Hz, depth in Cent}
   *   out     – Zielknoten (Standard: SFX-Bus)
   */
  function tone(o) {
    const ctx = engine.ctx;
    const osc = ctx.createOscillator();
    setWaveform(osc, o.wave);
    osc.frequency.setValueAtTime(o.freq, o.at);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.at + (o.slide || o.dur));
    const amp = ctx.createGain();
    const end = applyEnvelope(amp.gain, o.at, o.dur, o.vol, o.env || ENV.blip);
    connectChain([osc, createFilter(o.filter, o.at, o.dur), amp, o.out || engine.sfxBus]);
    if (o.vibrato) addVibrato(osc, o.vibrato, o.at, end);
    osc.start(o.at);
    osc.stop(end);
    osc.onended = () => amp.disconnect();  // verklungene Töne aus dem Graphen lösen
  }

  /** Rauschen aus dem vorberechneten Puffer – für Crash, Zischen, Wasser und Schlagzeug. */
  function noise(o) {
    const ctx = engine.ctx;
    const source = ctx.createBufferSource();
    source.buffer = engine.noiseBuffer;
    source.loop = true;
    const amp = ctx.createGain();
    const end = applyEnvelope(amp.gain, o.at, o.dur, o.vol, o.env || ENV.hit);
    connectChain([source, createFilter(o.filter, o.at, o.dur), amp, o.out || engine.sfxBus]);
    source.start(o.at, Math.random() * 0.5);  // zufälliger Einstieg: jedes Rauschen klingt etwas anders
    source.stop(end);
    source.onended = () => amp.disconnect();
  }

  /** Mehrere Töne nacheinander (Abstand gap in s) mit denselben Ton-Optionen. */
  function melody(notes, at, gap, opts) {
    notes.forEach((name, i) => tone({ ...opts, freq: hz(name), at: at + i * gap }));
  }

  /** Mehrere Töne gleichzeitig. */
  function chord(notes, at, opts) {
    melody(notes, at, 0, opts);
  }

  /**
   * ADSR-Hüllkurve auf einem Gain-Parameter; hold = wie lange die „Taste“ gedrückt ist.
   * setTargetAtTime nähert sich exponentiell an – das klingt natürlich und knackt nicht.
   * Liefert den Zeitpunkt, an dem der Ton verklungen ist.
   */
  function applyEnvelope(param, at, hold, peak, env) {
    const attackEnd = at + env.attack;
    const releaseStart = Math.max(attackEnd, at + hold);
    param.setValueAtTime(0, at);
    param.linearRampToValueAtTime(peak, attackEnd);
    param.setTargetAtTime(peak * env.sustain, attackEnd, Math.max(0.001, env.decay / 3));
    param.setTargetAtTime(0, releaseStart, Math.max(0.001, env.release / 5));
    return releaseStart + env.release;
  }

  /** Optionales Filter, dessen Grenzfrequenz von freq nach to wandern kann (z. B. „Wah“-Bass). */
  function createFilter(spec, at, dur) {
    if (!spec) return null;
    const filter = engine.ctx.createBiquadFilter();
    filter.type = spec.type || 'lowpass';
    filter.Q.value = spec.q != null ? spec.q : 1;
    filter.frequency.setValueAtTime(spec.freq, at);
    if (spec.to) filter.frequency.exponentialRampToValueAtTime(spec.to, at + Math.max(0.01, dur));
    return filter;
  }

  /** Vibrato: ein langsamer Sinus (LFO) wackelt an der Tonhöhe des Oszillators. */
  function addVibrato(osc, vibrato, at, end) {
    const lfo = engine.ctx.createOscillator();
    const depth = engine.ctx.createGain();
    lfo.frequency.value = vibrato.rate;
    depth.gain.value = vibrato.depth;  // in Cent
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(at);
    lfo.stop(end);
  }

  // Pulswellen mit schmalem Tastgrad klingen nach 8-Bit-Konsole (12,5 % / 25 %)
  const PULSE_DUTY = { pulse25: 0.25, pulse12: 0.125 };

  function setWaveform(osc, wave) {
    const duty = PULSE_DUTY[wave];
    if (duty) osc.setPeriodicWave(pulseWave(duty));
    else osc.type = wave || 'square';
  }

  /** Pulswelle als Fourier-Reihe: Anteil der n-ten Oberwelle = 2/(nπ) · sin(nπ · Tastgrad). */
  function pulseWave(duty) {
    if (!engine.waves[duty]) {
      const harmonics = 64;
      const real = new Float32Array(harmonics);
      const imag = new Float32Array(harmonics);
      for (let n = 1; n < harmonics; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
      engine.waves[duty] = engine.ctx.createPeriodicWave(real, imag);
    }
    return engine.waves[duty];
  }

  /** Verbindet Knoten der Reihe nach; null-Einträge (z. B. kein Filter) werden übersprungen. */
  function connectChain(nodes) {
    const chain = nodes.filter(Boolean);
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  }

  // Schlagzeug – ebenfalls nur aus Ton und Rauschen gebaut
  const DRUMS = {
    kick(at, vol, out) {  // Sinus mit schnell fallender Tonhöhe
      tone({ wave: 'sine', freq: 150, to: 40, slide: 0.1, at, dur: 0.1, vol, env: ENV.kick, out });
    },
    snare(at, vol, out) {  // Rauschen (Teppich) plus kurzer Ton (Fell)
      noise({ at, dur: 0.06, vol, env: ENV.snare, filter: { type: 'highpass', freq: 1200 }, out });
      tone({ wave: 'triangle', freq: 220, to: 120, slide: 0.06, at, dur: 0.04, vol: vol * 0.6, env: ENV.hit, out });
    },
    hat(at, vol, out, open) {  // sehr hohes Rauschen; offen klingt es länger
      const env = open ? ENV.snare : ENV.hit;
      noise({ at, dur: open ? 0.1 : 0.02, vol, env, filter: { type: 'highpass', freq: 7000 }, out });
    }
  };

  // ═══ 7. Sequencer ═══════════════════════════════════════════════════
  // Prinzip „Lookahead-Scheduling“: Ein ungenauer JavaScript-Timer (setInterval) wacht
  // alle 25 ms auf und plant alle Noten der nächsten 120 ms auf der exakten Uhr des
  // AudioContext (ctx.currentTime) ein. So bleibt der Takt stabil, auch wenn ein Frame ruckelt.

  const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACCIDENTALS = { '': 0, '#': 1, b: -1 };
  const CHORD_TYPES = { '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6] };  // Halbtonschritte: Dur, Moll, vermindert

  const sequencers = [];        // alle klingenden Tracks (der aktuelle und ggf. ausklingende)
  let currentSequencer = null;  // der Track, der gerade „dran“ ist
  let schedulerTimer = null;
  const compiledTracks = {};    // Cache: Track-Name → abspielbereite Daten

  /** 'A4' → 69 (MIDI-Nummer), 'C#5' → 73, 'Bb3' → 58; null bei unbekannter Schreibweise. */
  function noteToMidi(name) {
    const match = /^([A-G])([#b]?)(\d)$/.exec(String(name));
    if (!match) return null;
    return (Number(match[3]) + 1) * 12 + NOTE_OFFSETS[match[1]] + ACCIDENTALS[match[2]];
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** Frequenz eines Notennamens für die Soundeffekte: hz('A4') → 440. */
  function hz(name) {
    return midiToFreq(noteToMidi(name));
  }

  /** 'Am' → {root: 9, intervals: [0, 3, 7]} (root = Tonklasse 0–11). Unbekanntes wird C-Dur. */
  function parseChord(name) {
    const match = /^([A-G])([#b]?)(m|dim)?$/.exec(String(name));
    if (!match) return { root: 0, intervals: CHORD_TYPES[''] };
    const root = (NOTE_OFFSETS[match[1]] + ACCIDENTALS[match[2]] + 12) % 12;
    return { root, intervals: CHORD_TYPES[match[3] || ''] };
  }

  /** MIDI-Nummer des index-ten Akkordtons; der Grundton liegt zwischen low und low + 11. */
  function chordTone(chord, low, index) {
    const root = low + ((((chord.root - low) % 12) + 12) % 12);
    const size = chord.intervals.length;
    return root + chord.intervals[index % size] + 12 * Math.floor(index / size);
  }

  /**
   * Zerlegt ein Pattern in 16 Schritte: {value, length} am Notenanfang, sonst null.
   * convert macht aus einem Zeichen/Wort den Wert (ungültig → Pause).
   */
  function parseSteps(pattern, convert) {
    const text = String(pattern || '').trim();
    const tokens = /\s/.test(text) ? text.split(/\s+/) : text.split('');
    if (tokens.length !== STEPS_PER_BAR) warn(`Pattern hat ${tokens.length} statt ${STEPS_PER_BAR} Schritte: "${text}"`);
    const steps = [];
    let held = null;  // zuletzt angeschlagener Ton – '-' verlängert ihn
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      const token = tokens[i] || '.';
      if (token === '-' && held) {
        held.length += 1;
        steps.push(null);
        continue;
      }
      const value = token === '.' || token === '-' ? null : convert(token);
      held = value === null || Number.isNaN(value) ? null : { value, length: 1 };
      steps.push(held);
    }
    return steps;
  }

  /** Wandelt die lesbaren Track-Daten einmalig in schnell abspielbare Strukturen um. */
  function compileTrack(def) {
    const bpm = Math.min(BPM_RANGE[1], Math.max(BPM_RANGE[0], Number(def.bpm) || 120));
    const chords = (def.chords && def.chords.length ? def.chords : ['C']).map(parseChord);
    const lead = def.lead ? {
      inst: INSTRUMENTS[def.lead.sound] || INSTRUMENTS.lead,
      bars: (def.lead.bars || []).map((bar) => (bar ? parseSteps(bar, noteToMidi) : null))
    } : null;
    return {
      stepDur: 60 / bpm / 4,  // Dauer eines 16tels in Sekunden
      swing: def.swing || 0,
      volume: def.volume != null ? def.volume : 1,
      pump: def.pump || 0,
      bars: Math.max(chords.length, lead ? lead.bars.length : 0),
      chords,
      bass: compileChordVoice(def.bass),
      arp: compileChordVoice(def.arp),
      lead,
      drums: compileDrums(def.drums),
      fill: def.fill ? compileDrums({ ...def.drums, ...def.fill }) : null
    };
  }

  function compileChordVoice(voice) {
    if (!voice) return null;
    const low = noteToMidi(voice.low);
    return {
      inst: INSTRUMENTS[voice.sound] || INSTRUMENTS.pluck,
      low: low !== null ? low : 48,
      steps: parseSteps(voice.steps, Number)
    };
  }

  function compileDrums(drums) {
    const lanes = {};
    Object.keys(DRUMS).forEach((lane) => {
      if (drums && drums[lane]) lanes[lane] = parseSteps(drums[lane], String);
    });
    return lanes;
  }

  function getCompiledTrack(name) {
    if (!compiledTracks[name]) compiledTracks[name] = compileTrack(TRACKS[name]);
    return compiledTracks[name];
  }

  /** Startet einen Track mit eigenem Gain (für Fades); liefert den Sequencer. */
  function startSequencer(name, now, fadeIn) {
    const ctx = engine.ctx;
    const song = getCompiledTrack(name);
    const startAt = now + SCHEDULER.startDelayS;
    const output = ctx.createGain();  // Track-Lautstärke: hier laufen die Fades
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(song.volume, startAt + fadeIn);
    output.connect(engine.musicBus);
    const voices = ctx.createGain();  // alle Stimmen außer Schlagzeug (für das Pumpen)
    voices.connect(output);
    const seq = { name, song, output, voices, step: 0, nextTime: startAt, stopAt: Infinity };
    sequencers.push(seq);
    startScheduler();
    scheduleAhead();
    return seq;
  }

  /** Blendet einen Track aus; der Scheduler entfernt ihn danach. */
  function fadeOutSequencer(seq, now) {
    const gain = seq.output.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + FADE.out);
    seq.stopAt = now + FADE.out;
  }

  function removeSequencer(index) {
    const seq = sequencers[index];
    seq.output.disconnect();
    sequencers.splice(index, 1);
    if (seq === currentSequencer) currentSequencer = null;
  }

  function startScheduler() {
    if (schedulerTimer === null) schedulerTimer = setInterval(guard(scheduleAhead), SCHEDULER.intervalMs);
  }

  function stopScheduler() {
    if (schedulerTimer === null) return;
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }

  /** Herzschlag des Schedulers: plant für jeden Track alle 16tel bis zum Horizont. */
  function scheduleAhead() {
    const now = engine.ctx.currentTime;
    const horizon = now + SCHEDULER.aheadS;
    for (let i = sequencers.length - 1; i >= 0; i--) {
      const seq = sequencers[i];
      if (seq.nextTime < now - SCHEDULER.maxLagS) seq.nextTime = now;  // nach einem Hänger nicht nachholen
      while (seq.nextTime < horizon && seq.nextTime < seq.stopAt) {
        if (!muted) playStep(seq, seq.nextTime);  // stumm: Takt läuft weiter, aber ohne Töne
        seq.step += 1;
        seq.nextTime += seq.song.stepDur;
      }
      if (now > seq.stopAt + 0.5) removeSequencer(i);
    }
    if (!sequencers.length) stopScheduler();
  }

  /** Spielt alle Stimmen eines 16tel-Schritts. */
  function playStep(seq, time) {
    const song = seq.song;
    const pos = seq.step % STEPS_PER_BAR;
    const bar = Math.floor(seq.step / STEPS_PER_BAR) % song.bars;
    const at = time + (pos % 2 === 1 ? song.swing * song.stepDur : 0);  // Swing: jedes 2. 16tel später
    const chordOfBar = song.chords[bar % song.chords.length];
    const isFillBar = song.fill && (bar + 1) % FILL_EVERY_BARS === 0;
    playDrums(seq, isFillBar ? song.fill : song.drums, pos, at);
    playChordVoice(seq, song.bass, chordOfBar, pos, at);
    playChordVoice(seq, song.arp, chordOfBar, pos, at);
    playLead(seq, bar, pos, at);
  }

  function playDrums(seq, lanes, pos, at) {
    Object.keys(lanes).forEach((lane) => {
      const hit = lanes[lane][pos];
      if (!hit) return;
      DRUMS[lane](at, DRUM_VOLUME[lane] * (VELOCITY[hit.value] || VELOCITY.x), seq.output, hit.value === 'o');
      if (lane === 'kick' && seq.song.pump) duck(seq.voices.gain, at, seq.song.pump);
    });
  }

  /** Sidechain-Pumpen: bei der Bassdrum kurz leiser werden, dann wieder anschwellen. */
  function duck(param, at, depth) {
    param.setTargetAtTime(1 - depth, at, 0.005);
    param.setTargetAtTime(1, at + 0.03, 0.07);
  }

  function playChordVoice(seq, voice, chordOfBar, pos, at) {
    const step = voice && voice.steps[pos];
    if (step) playNote(seq, voice.inst, chordTone(chordOfBar, voice.low, step.value), at, step.length);
  }

  function playLead(seq, bar, pos, at) {
    const lead = seq.song.lead;
    const steps = lead && lead.bars[bar % lead.bars.length];
    const step = steps && steps[pos];
    if (step) playNote(seq, lead.inst, step.value, at, step.length);
  }

  function playNote(seq, inst, midi, at, lengthInSteps) {
    tone({
      wave: inst.wave,
      freq: midiToFreq(midi),
      at,
      dur: lengthInSteps * seq.song.stepDur * inst.gate,
      vol: inst.vol,
      env: inst.env,
      filter: inst.filter,
      vibrato: inst.vibrato,
      out: seq.voices
    });
  }

  /**
   * Gleicht die tatsächlich laufende Musik mit dem Wunsch (music.current) ab.
   * Läuft der Kontext noch nicht (keine Nutzer-Geste, Tab versteckt), passiert das später.
   */
  function syncMusic() {
    if (!isRunning()) return;
    const wanted = music.current;
    if (currentSequencer && currentSequencer.name === wanted) return;
    const now = engine.ctx.currentTime;
    const isChange = !!currentSequencer;  // Wechsel: überblenden; aus der Stille: sofort voll da
    if (isChange) fadeOutSequencer(currentSequencer, now);
    currentSequencer = wanted ? startSequencer(wanted, now, isChange ? FADE.in : 0) : null;
  }

  // ═══ 8. Stummschalten, Tab-Wechsel, öffentliche API ════════════════

  function loadMuted() {
    try {
      return !!globalThis.localStorage && globalThis.localStorage.getItem(MUTE_KEY) === '1';
    } catch (error) {
      return false;  // gesperrter Speicher (privater Modus, file://-Einschränkungen …)
    }
  }

  function saveMuted() {
    try {
      if (globalThis.localStorage) globalThis.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (error) { /* dann bleibt die Einstellung eben nur bis zum Neuladen */ }
  }

  function setMuted(value) {
    muted = !!value;
    saveMuted();
    attempt(applyMuteToGraph);
    return muted;
  }

  /** Master-Gain sofort (mit winziger Rampe gegen Knacken) auf 0 bzw. die Normal-Lautstärke. */
  function applyMuteToGraph() {
    if (!engine.ctx) return;
    const now = engine.ctx.currentTime;
    const gain = engine.master.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(muted ? 0 : VOLUME.master, now, FADE.mute);
  }

  function unlock() {
    const ctx = createEngine();
    if (!ctx) return;
    if (!engine.primed) {
      engine.primed = true;
      playSilence(ctx);
    }
    if (ctx.state !== 'running' && !pausedByVisibility) afterResume(ctx.resume());
    syncMusic();
  }

  /** resume() liefert (in neueren Browsern) ein Promise – danach Musik nachziehen. */
  function afterResume(promise) {
    if (promise && typeof promise.then === 'function') promise.then(guard(syncMusic), () => {});
  }

  /** Versteckter Tab: Audio-Uhr anhalten (Musik pausiert exakt) und beim Zurückkehren fortsetzen. */
  function onVisibilityChange() {
    const ctx = engine.ctx;
    if (!ctx) return;
    if (document.hidden) {
      if (ctx.state !== 'running') return;
      pausedByVisibility = true;
      const promise = ctx.suspend();
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      afterResume(ctx.resume());
    }
  }

  function playSfx(name) {
    if (muted || !canPlaySfx() || !Object.prototype.hasOwnProperty.call(SFX, name)) return;
    const now = engine.ctx.currentTime;
    const last = lastPlayedAt[name];
    if (last !== undefined && now - last < SFX_MIN_GAP_S) return;
    lastPlayedAt[name] = now;
    SFX[name](now + SFX_OFFSET_S);
  }

  function playMusic(track) {
    const wanted = Object.prototype.hasOwnProperty.call(TRACKS, track) ? track : null;  // unbekannt = Stille
    if (wanted === music.current) return;
    music.current = wanted;
    syncMusic();
  }

  function stopMusic() {
    music.current = null;
    syncMusic();
  }

  function status() {
    const ctx = engine.ctx;
    return {
      supported: !!(globalThis.AudioContext || globalThis.webkitAudioContext),
      state: ctx ? ctx.state : 'kein AudioContext',
      muted,
      track: music.current,
      playing: currentSequencer ? currentSequencer.name : null,
      sequencers: sequencers.length,
      bar: currentSequencer ? Math.floor(currentSequencer.step / STEPS_PER_BAR) + 1 : 0,
      time: ctx ? Math.round(ctx.currentTime * 100) / 100 : 0
    };
  }

  // ── Fehlerschutz ──
  let hasWarned = false;

  function warn(message) {
    if (typeof console !== 'undefined') console.warn('[Audio] ' + message);
  }

  /** Meldet nur den ersten abgefangenen Fehler, damit man ihn findet, ohne die Konsole zu fluten. */
  function warnOnce(error) {
    if (hasWarned) return;
    hasWarned = true;
    warn('Fehler abgefangen, das Spiel läuft weiter: ' + (error && error.message ? error.message : error));
  }

  /** Führt fn aus und schluckt Fehler – Audio darf das Spiel nie abstürzen lassen. */
  function attempt(fn, arg) {
    try {
      return fn(arg);
    } catch (error) {
      warnOnce(error);
      return undefined;
    }
  }

  function guard(fn) {
    return (arg) => attempt(fn, arg);
  }

  // Tab-Wechsel beobachten (gilt für die ganze Seitenlaufzeit, deshalb kein Aufräumen nötig)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', guard(onVisibilityChange));
  }

  const music = {
    current: null,  // gewünschter Track – auch wenn er noch auf die erste Nutzer-Geste wartet
    play: guard(playMusic),
    stop: guard(stopMusic)
  };

  SS.Audio = {
    unlock: guard(unlock),
    sfx: guard(playSfx),
    music,
    isMuted: () => muted,
    setMuted: (value) => attempt(setMuted, value),
    toggleMute: () => attempt(setMuted, !muted),
    status: guard(status)
  };
})();
