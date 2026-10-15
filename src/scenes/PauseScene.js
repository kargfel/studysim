/* PLATZHALTER – wird ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  class PauseScene extends Phaser.Scene {
    constructor() { super('PauseScene'); }
    create() {
      SS.UI.text(this, 400, 300, 'PAUSE', 'title').setOrigin(0.5);
      SS.UI.onKey(this, 'ESC', () => { this.scene.resume('GameScene'); this.scene.stop(); });
    }
  }
  SS.scenes.PauseScene = PauseScene;
})();
