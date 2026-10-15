/*
 * main.js – startet das Phaser-Spiel. Wird als letzte Datei geladen.
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;

  // Reihenfolge = Zeichenreihenfolge: spätere Szenen liegen oben.
  const SCENE_ORDER = [
    'BootScene',
    'MenuScene',
    'GameScene',
    'HudScene',
    'EduroamScene',
    'WasserspenderScene',
    'KlausurScene',
    'PruefungScene',
    'PauseScene',
    'GameOverScene'
  ];

  const root = document.getElementById('game');

  if (!globalThis.Phaser) {
    root.innerHTML = '<div class="fatal">Phaser konnte nicht geladen werden.<br>' +
      'Weder das CDN noch <code>vendor/phaser.min.js</code> waren erreichbar.</div>';
    return;
  }

  const missing = SCENE_ORDER.filter((key) => !SS.scenes[key]);
  if (missing.length) console.warn('[Studiums-Simulator] Fehlende Szenen:', missing.join(', '));

  // Audio darf erst nach einer Nutzer-Geste starten (Browser-Richtlinie).
  const unlock = () => SS.Audio && SS.Audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  SS.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: C.WIDTH,
    height: C.HEIGHT,
    backgroundColor: C.CSS.night,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    audio: { noAudio: true }, // eigene WebAudio-Implementierung in core/audio.js
    input: { activePointers: 2 },
    scene: SCENE_ORDER.map((key) => SS.scenes[key]).filter(Boolean)
  });
})();
