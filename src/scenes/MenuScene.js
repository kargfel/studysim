/* PLATZHALTER – wird ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class MenuScene extends Phaser.Scene {
    constructor() { super('MenuScene'); }
    create() {
      SS.UI.background(this, C.COLORS.night, C.COLORS.dhbwRedDark);
      SS.UI.text(this, C.WIDTH / 2, 160, 'STUDIUMS-SIMULATOR', 'title').setOrigin(0.5);
      SS.UI.button(this, C.WIDTH / 2, 340, 'Semester starten', () => this.scene.start('GameScene', { newRun: true }), { key: 'ENTER' });
    }
  }
  SS.scenes.MenuScene = MenuScene;
})();
