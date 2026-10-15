/* PLATZHALTER – wird durch die echte Side Quest ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class WasserspenderScene extends Phaser.Scene {
    constructor() { super('WasserspenderScene'); }
    create() {
      SS.UI.background(this, C.COLORS.night, C.COLORS.panel);
      SS.SideQuest.intro(this, { title: 'Wasserspender', subtitle: 'Platzhalter', lines: ['Diese Szene wird gerade gebaut.'] }, () => {
        SS.SideQuest.outro(this, { id: 'wasserspender', title: 'Wasserspender', success: true, ects: 1, message: 'Platzhalter bestanden.' });
      });
    }
  }
  SS.scenes.WasserspenderScene = WasserspenderScene;
})();
