/* PLATZHALTER – wird ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class GameOverScene extends Phaser.Scene {
    constructor() { super('GameOverScene'); }
    create() {
      const run = SS.State.run;
      SS.State.saveHighscore();
      SS.UI.background(this, C.COLORS.night, C.COLORS.panel);
      SS.UI.text(this, C.WIDTH / 2, 200, run.outcome === 'graduated' ? 'BESTANDEN' : 'GAME OVER', 'title').setOrigin(0.5);
      SS.UI.text(this, C.WIDTH / 2, 280, `ECTS: ${run.ects} · Note: ${SS.State.formatGrade(run.grade)}`, 'h2').setOrigin(0.5);
      SS.UI.button(this, C.WIDTH / 2, 400, 'Menü', () => this.scene.start('MenuScene'), { key: 'ENTER' });
    }
  }
  SS.scenes.GameOverScene = GameOverScene;
})();
