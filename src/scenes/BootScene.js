/* PLATZHALTER – wird ersetzt. Erzeugt Texturen und leitet weiter (?scene=… für Tests). */
(function () {
  'use strict';
  const SS = globalThis.SS;
  class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }
    create() {
      SS.Textures.generateAll(this);
      const params = SS.getUrlParams();
      const target = params.scene;
      if (target === 'GameScene') {
        this.scene.start('GameScene', { newRun: true, section: Number(params.section) || 0, god: params.god === '1' });
        return;
      }
      if (target && target !== 'BootScene' && SS.scenes[target]) {
        this.scene.start(target, { practice: true, debug: true });
        return;
      }
      this.scene.start('MenuScene');
    }
  }
  SS.scenes.BootScene = BootScene;
})();
