/*
 * config.js – zentrale Konstanten des Studiums-Simulators.
 *
 * Alle Dateien hängen sich an den globalen Namensraum `SS` (Studiums-Simulator).
 * Es werden bewusst klassische <script>-Dateien statt ES-Module verwendet,
 * damit das Spiel per Doppelklick auf index.html (file://) startet.
 * In Node (Tests) ist `globalThis` der Namensraum-Träger.
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});

  SS.scenes = SS.scenes || {};

  SS.CONFIG = {
    WIDTH: 800,
    HEIGHT: 600,

    // ── Runner-Welt ──────────────────────────────────────────────
    TILE: 40,               // Kachelgröße in px
    GROUND_Y: 520,          // Oberkante des Bodens (Bodenreihe = Zeile 13)
    ROWS: 15,               // 600 / 40
    PLAYER_SIZE: 36,        // Hitbox des Würfels (gezeichnet wird 40 px)

    // ── Physik (px, px/s, px/s²) ─────────────────────────────────
    SPEED: { normal: 360, fast: 432 },   // 9 bzw. 10,8 Kacheln pro Sekunde
    GRAVITY: 3600,
    JUMP_V: 800,            // Sprunghöhe ≈ 2,2 Kacheln, Sprungweite ≈ 4 Kacheln
    PAD_V: 1100,            // Jump-Pad: ≈ 4,2 Kacheln hoch
    ORB_V: 780,             // Sprung-Orb in der Luft
    MAX_FALL: 1400,
    LAND_SNAP: 10,          // Toleranz: so viele px unter einer Kante wird noch aufgesetzt
    STEP: 1 / 240,          // fester Physik-Zeitschritt

    // ── Regeln ───────────────────────────────────────────────────
    ATTEMPTS_PER_SECTION: 3,  // Erstversuch + 2 Nachklausuren
    ECTS_PER_COIN: 1,
    PASS_GRADE: 4.0,          // schlechter als 4,0 = nicht bestanden

    STORAGE_KEY: 'studiums-simulator.v1',

    // ── Farben (Phaser erwartet 0xRRGGBB) ───────────────────────
    COLORS: {
      dhbwRed: 0xe2001a,
      dhbwRedDark: 0x9e0012,
      dhbwGray: 0x5d6770,
      ink: 0xffffff,
      inkSoft: 0xc9cbe0,
      night: 0x12101c,
      panel: 0x1d1a2e,
      panelLine: 0x3a3557,
      yellow: 0xffd400,
      cyan: 0x22d3ee,
      magenta: 0xff3df2,
      green: 0x22c55e,
      orange: 0xf97316,
      blue: 0x3b82f6,
      danger: 0xef4444
    },

    // Abschnitts-Themen: Himmel oben/unten, Boden, Akzent
    THEMES: {
      campus:    { top: 0x1e3a8a, bottom: 0x0ea5e9, ground: 0x0b1d4a, line: 0x7dd3fc, accent: 0xffd400, label: 'Campus' },
      vorlesung: { top: 0x2e1065, bottom: 0x7c3aed, ground: 0x1e0b3d, line: 0xc4b5fd, accent: 0x22d3ee, label: 'Hörsaal' },
      klausur:   { top: 0x3b0a0a, bottom: 0xdc2626, ground: 0x2a0606, line: 0xfca5a5, accent: 0xffd400, label: 'Prüfungsraum' },
      projekt:   { top: 0x0f172a, bottom: 0x475569, ground: 0x0b1120, line: 0xcbd5e1, accent: 0xe2001a, label: 'Partnerunternehmen' },
      praxis:    { top: 0x082f49, bottom: 0x0369a1, ground: 0x04212f, line: 0x7dd3fc, accent: 0xf97316, label: 'Praxisphase' }
    },

    // CSS-Farbstrings für Phaser-Text
    CSS: {
      ink: '#ffffff',
      inkSoft: '#c9cbe0',
      dhbwRed: '#e2001a',
      yellow: '#ffd400',
      cyan: '#22d3ee',
      green: '#22c55e',
      danger: '#ef4444',
      night: '#12101c'
    },

    FONTS: {
      display: '"Arial Black", "Arial Bold", Gadget, sans-serif',
      body: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
      mono: 'Menlo, Consolas, "Courier New", monospace'
    }
  };

  /** Liest Debug-/Test-Parameter aus der URL (?scene=…&section=…&god=1). */
  SS.getUrlParams = function getUrlParams() {
    const params = {};
    try {
      const search = (globalThis.location && globalThis.location.search) || '';
      new URLSearchParams(search).forEach((value, key) => { params[key] = value; });
    } catch (e) { /* Node oder exotischer Browser: keine Parameter */ }
    return params;
  };
})();
