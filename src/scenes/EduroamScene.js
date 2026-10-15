/* PLATZHALTER – wird durch die echte Side Quest ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class EduroamScene extends Phaser.Scene {
    constructor() { super('EduroamScene'); }
    create() {
      SS.UI.background(this, C.COLORS.night, C.COLORS.panel);
      SS.SideQuest.intro(this, { title: 'eduroam einrichten', subtitle: 'Platzhalter', lines: ['Diese Szene wird gerade gebaut.'] }, () => {
        SS.SideQuest.outro(this, { id: 'eduroam', title: 'eduroam einrichten', success: true, ects: 1, message: 'Platzhalter bestanden.' });
      });
    }
  }
  SS.scenes.EduroamScene = EduroamScene;
})();
