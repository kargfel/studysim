/*
 * semester.js – das Level „Ein Semester“: vier Abschnitte, am Ende jedes Abschnitts
 * setzt der Parser automatisch einen Checkpoint, der die Side Quest startet.
 *
 * Aufbau: Oben stehen kleine ASCII-Bausteine (B), unten werden sie pro Abschnitt mit
 * L.join(...) nebeneinandergesetzt. L.gap(n) = n Kacheln freier Boden, L.pit(n) = n Kacheln Grube.
 * Jede Zeile eines Bausteins ist eine Kachelreihe (oben → unten), die letzte Zeile ist der Boden.
 * Bausteine werden unten bündig ausgerichtet, eine Spalte = eine Kachel (40 px).
 *
 * Zeichen (vollständig in src/core/level.js):
 *   '=' Boden   '_' Grube   '#' Block   '^' Stachel   'v' hängender Stachel   'o' ECTS-Münze
 *   'J' Jump-Pad   'O' Sprung-Orb (in der Luft drücken)
 *   'G' Praxisphase (kopfüber)   'T' Theoriephase   'S' / 'N' Tempo schnell / normal
 * Das Tempo eines ganzen Abschnitts steht in `speed`; S und N braucht man nur für einen
 * Tempowechsel mitten im Abschnitt.
 *
 * Faustregeln (normales Tempo 9 Kacheln/s, schnelles 10,8 Kacheln/s):
 *   - Sprung ≈ 2,2 Kacheln hoch und 4 Kacheln weit (schnell ≈ 4,8), Jump-Pad ≈ 4,2 Kacheln hoch.
 *   - Sprungfenster = so viel Zeit bleibt für den Absprung (auf freier Strecke, normal / schnell):
 *       ^ 246 / 267 ms    ^^ 138 / 175 ms    ^^# 188 / 217 ms    ^^^ oder ^ ^ 25 / 83 ms (unfair)
 *       Block 342 ms    Grube 2: 329 / 354 ms    Grube 3: 217 / 263 ms    Grube 4: 108 / 171 ms
 *       vom Pult über drei Stacheln (#####^^^) 171 / 217 ms; kopfüber (v, Deckenlücke) wie am Boden.
 *     Schnelles Tempo macht Stachel- und Grubensprünge leichter, nicht schwerer: Man ist gleich
 *     lange in der Luft, aber schneller über das Hindernis hinweg.
 *   - Unter 120 ms wird es Glückssache. Aber auch breitere Fenster summieren sich, jeder Pflichtsprung
 *     kann einen Versuch kosten. Darum ^^ und Grube 3 bei normalem Tempo sparsam einsetzen und drei
 *     Stacheln am Stück nur vom Block aus (oder mit Pad bzw. Orb). Abschnitt 1 soll der leichteste
 *     sein, danach wird es von Abschnitt zu Abschnitt schwerer.
 *   - Mindestens 5 Kacheln (schnell: 6) zwischen zwei Pflichtsprüngen – Treppenstufen daher 5 (6) breit.
 *   - Eine Münze 2 Kacheln über einem Stachel liegt genau auf Sprunghöhe. Über einer Grube hängt sie
 *     bei schnellem Tempo eine Reihe höher (grubeMitMuenzeHoch).
 *   - Neues (Pad, Orb) erst gefahrlos zeigen, dann einsetzen: Wer instinktiv springt, soll dabei nicht
 *     gleich durchfallen (probePad, probeOrb).
 *   - Praxisphase: Die Decke ('#') liegt 5 Reihen über dem Boden und muss durchgehen –
 *     eine Lücke ab 2 Kacheln ist eine Grube nach oben und muss übersprungen werden.
 *   - Die ersten 8 und die letzten 8 Spalten eines Abschnitts bleiben frei (Respawn, Checkpoint).
 *
 * Nach jeder Änderung prüfen:  node tests/beatability.mjs
 *   „schaffbar“ heißt nur, dass es einen Weg gibt. Wie eng er ist, steht in der Zeile
 *   „Sprungfenster“ darunter; unter 120 ms meldet der Prüfer eine WARNUNG.
 * Ansehen (unverwundbar):      index.html?scene=GameScene&section=1&god=1
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const L = SS.Level;

  // ── Konstanten ──────────────────────────────────────────────
  const ANLAUF = 12;   // freie Kacheln am Abschnittsanfang (Respawn; Pflicht: mind. 8)
  const AUSLAUF = 12;  // freie Kacheln vor dem Checkpoint (Pflicht: mind. 8)

  // ── Bausteine ───────────────────────────────────────────────
  const B = {
    // Grundformen
    stachel: ['^', '='],                    // eine Deadline
    doppelstachel: ['^^', '=='],            // zwei Deadlines in derselben Woche (enges Fenster)
    doppelstachelStapel: ['^^#', '==='],    // dahinter ein Stapel: wer zu früh springt, landet noch darauf
    block: ['#', '='],                      // Skriptstapel: drüber oder drauf
    bank: ['###', '==='],                   // Bank im Innenhof

    // ECTS-Münze über einer Deadline: wer sauber springt, nimmt sie im Scheitelpunkt mit
    stachelMitMuenze: [
      'o',
      ' ',
      '^',
      '='
    ],
    // Grube mit Münze in der Mitte (wird im Flug eingesammelt)
    grubeMitMuenze: [
      ' o ',
      '   ',
      '___'
    ],
    // Dasselbe für schnelles Tempo: Der Sprung ist gleich hoch, aber länger – eine Reihe tiefer
    // würde ein mittig getimter Sprung die Münze überfliegen.
    grubeMitMuenzeHoch: [
      ' o ',
      '   ',
      '   ',
      '___'
    ],

    // ── Abschnitt 1: Campus ──
    // Treppe zum Hörsaal: drei Stufen hoch (je 5 breit), oben eine Münze, dann wieder runter
    hoersaalTreppe: [
      '            o            ',
      '          #####          ',
      '     ###############     ',
      '#########################',
      '========================='
    ],

    // ── Abschnitt 2: Vorlesung ──
    // Sitzreihe: aufspringen, über den Stachel, am Ende runter
    sitzreihe: [
      '     ^    ',
      '##########',
      '=========='
    ],
    // Hörsaal von hinten: drei Stufen hoch (je 5 breit), dann ein Satz nach unten
    hoersaalStufen: [
      '          #####',
      '     ##########',
      '###############',
      '==============='
    ],
    // Gruppenarbeit: von Tisch zu Tisch, dazwischen Deadlines
    tischHuepfer: [
      '####^^####^^####',
      '================'
    ],
    // Praxisphase: G dreht die Schwerkraft, man läuft kopfüber an der Decke.
    // Hängende Stacheln (v, hier nur einzelne) überspringt man „nach unten“, die schmale Lücke
    // in der Decke ebenso. Die Münze hängt unter einem Stachel. T bringt den Würfel zurück auf den Boden.
    praxisphase: [
      '############################################  ###############################',
      '           v       v                v                        v     v         ',
      '                                                                          T  ',
      '                                    o                                        ',
      '  G                                                                          ',
      '============================================================================='
    ],

    // ── Abschnitt 3: Klausuren (schnelles Tempo) ──
    // Klausurtische: von Tisch zu Tisch über je drei Stacheln
    klausurTische: [
      '#####^^^#####^^^#####',
      '====================='
    ],
    // Spickzettel-Falle: vom Pult aus über drei Stacheln
    pultDreifach: [
      '#####^^^',
      '========'
    ],
    // Stoffberg: zwei Stufen hoch (je 6 breit, passend zum Tempo) und wieder runter
    stoffberg: [
      '      ######      ',
      '##################',
      '=================='
    ],
    // Pultreihe: auf dem Pult über einen Stachel, danach liegt eine Münze
    pultreihe: [
      '      ^     o   ',
      '################',
      '================'
    ],

    // ── Abschnitt 4: Projekt ──
    // Zum Ausprobieren, bevor es ernst wird: ein Pad und ein Orb auf freier Strecke.
    // Drüberlaufen, Springen oder Halten ist hier ungefährlich – wer instinktiv springt,
    // lernt das Element kennen, ohne durchzufallen.
    probePad: ['J', '='],
    probeOrb: [
      'O',
      ' ',
      ' ',
      '='
    ],
    // Jump-Pad vor der Wand: katapultiert aufs Dach (keine Taste nötig), oben Münze und Stachel
    padWand: [
      '     o    ^      ',
      '    #############',
      '    #############',
      '  J #############',
      '================='
    ],
    // Orb über vier Stacheln: abspringen und am Orb in der Luft noch einmal drücken
    orbFeld: [
      '   O   ',
      '       ',
      '  ^^^^ ',
      '======='
    ],
    // Pad direkt vor drei Stacheln: nicht springen, das Pad trägt drüber
    padStacheln: [
      'J^^^',
      '===='
    ],
    // Zweite Praxisphase beim Partnerunternehmen: eine breitere Lücke (3 Kacheln) und ein hängender
    // Besprechungstisch (ein Block unter der Decke = eine Stufe, unter ihm liegt die Münze)
    praxisphaseProjekt: [
      '#########################   ################################  ########################',
      '          v      v                ########      v      v           v       v          ',
      '                                     o                                             T  ',
      '                                                                                      ',
      '  G                                                                                   ',
      '======================================================================================'
    ],
    // Bürotische: von Tisch zu Tisch über je zwei Stacheln, der Chefschreibtisch am Ende ist höher
    bueroTische: [
      '             ###',
      '####^^#####^^###',
      '================'
    ],
    // Finale „Abgabe“: Der erste Orb trägt über vier Stacheln. Wer am zweiten noch einmal drückt,
    // holt die Münze ganz oben (für das Überleben nicht nötig)
    orbKette: [
      '        o   ',
      '            ',
      '      O     ',
      '   O        ',
      '            ',
      '  ^^^^      ',
      '============'
    ]
  };

  // ── Das Level ───────────────────────────────────────────────
  SS.Levels.semester = {
    id: 'semester',
    title: 'Ein Semester',
    sections: [
      {
        id: 'semesterstart',
        title: 'Semesterstart',
        subtitle: 'Wo ist eigentlich Raum 104?',
        theme: 'campus',
        sideQuest: 'EduroamScene',
        speed: 'normal',
        rows: L.join(
          L.gap(ANLAUF),
          // Erste Deadlines: einzelne Stacheln mit viel Platz
          B.stachel, L.gap(11), B.stachel, L.gap(11), B.stachel, L.gap(14),
          // Skriptstapel: Blöcke zum Drüber- oder Draufspringen
          B.block, L.gap(10), B.bank, L.gap(10), B.block, L.gap(7), B.block, L.gap(14),
          // Erste Münze über einer Deadline
          B.stachelMitMuenze, L.gap(12),
          // Mensa-Schlange: Stacheln im Takt
          B.stachel, L.gap(7), B.stachel, L.gap(7), B.stachel, L.gap(14),
          // Treppe zum Hörsaal (Münze oben)
          B.hoersaalTreppe, L.gap(12),
          // Baustelle auf dem Campus: kleine Gruben
          L.pit(2), L.gap(10), L.pit(2), L.gap(8), B.block, L.gap(7), B.stachel, L.gap(14),
          // Bänke im Innenhof
          B.bank, L.gap(6), B.bank, L.gap(5), B.stachel, L.gap(12),
          // Endspurt zum Hörsaal: Kombination, eine letzte kleine Grube, dann die Münze über der Deadline
          B.stachel, L.gap(6), B.block, L.gap(6), B.stachel, L.gap(9), L.pit(2), L.gap(12),
          B.stachelMitMuenze, L.gap(AUSLAUF)
        )
      },
      {
        id: 'vorlesungszeit',
        title: 'Vorlesungszeit',
        subtitle: 'Folie 3 von 187',
        theme: 'vorlesung',
        sideQuest: 'WasserspenderScene',
        speed: 'normal',
        rows: L.join(
          L.gap(ANLAUF),
          // Aufwärmen
          B.block, L.gap(10), B.stachel, L.gap(9), B.block, L.gap(8), B.stachel, L.gap(15),
          // Sitzreihen und Stufen im Hörsaal
          B.sitzreihe, L.gap(10), B.hoersaalStufen, L.gap(12),
          // Doppelstunde: Münze über der ersten Deadline, danach Skriptstapel und Deadline
          B.stachelMitMuenze, L.gap(9), B.block, L.gap(7), B.stachel, L.gap(14),
          // Praxisphase: kopfüber an der Decke (Münze unter einem hängenden Stachel)
          B.praxisphase, L.gap(10),
          // Gruppenarbeit und Lerngruppe
          B.tischHuepfer, L.gap(12), B.bank, L.gap(6), B.stachel, L.gap(13),
          // Gruben, über der zweiten liegt eine Münze
          L.pit(2), L.gap(8), B.grubeMitMuenze, L.gap(12),
          // Endspurt vor dem Wochenende
          B.stachel, L.gap(8), B.block, L.gap(7), B.block, L.gap(6), B.stachel, L.gap(8),
          L.pit(2), L.gap(AUSLAUF)
        )
      },
      {
        id: 'klausurenphase',
        title: 'Klausurenphase',
        subtitle: 'Fünf Klausuren in einer Woche',
        theme: 'klausur',
        sideQuest: 'KlausurScene',
        speed: 'fast',
        rows: L.join(
          L.gap(ANLAUF),
          // Tempo spüren
          B.stachel, L.gap(10), B.stachel, L.gap(10), B.stachel, L.gap(15),
          // Wissenslücken: Gruben, die letzte ist breiter
          L.pit(2), L.gap(10), L.pit(2), L.gap(11), L.pit(3), L.gap(14),
          // Klausurtische
          B.klausurTische, L.gap(12),
          // Multiple Choice: Münze über der ersten Deadline, dann zwei Deadlines vor einem Stapel
          B.stachelMitMuenze, L.gap(9), B.doppelstachelStapel, L.gap(7), B.stachel, L.gap(14),
          // Spickzettel-Falle und Stoffberg
          B.pultDreifach, L.gap(12), B.stoffberg, L.gap(12),
          // Stoffwiederholung
          L.pit(2), L.gap(9), B.stachel, L.gap(8), B.block, L.gap(6), B.stachel, L.gap(15),
          // Prüfungsmarathon: Deadlines im Takt, in der Mitte eine doppelte
          B.stachel, L.gap(6), B.doppelstachel, L.gap(6), B.stachel, L.gap(14),
          // Pultreihe mit Münze
          B.pultreihe, L.gap(12),
          // Letzte Klausur der Woche (Münze über der Grube)
          B.grubeMitMuenzeHoch, L.gap(8), B.stachel, L.gap(7), B.stachel, L.gap(8), L.pit(3), L.gap(AUSLAUF)
        )
      },
      {
        id: 'projektphase',
        title: 'Projektphase',
        subtitle: 'Abgabe morgen, 8 Uhr',
        theme: 'projekt',
        sideQuest: 'PruefungScene',
        speed: 'normal',
        rows: L.join(
          L.gap(ANLAUF),
          // Kick-off, danach ein Jump-Pad zum Ausprobieren
          B.stachel, L.gap(9), B.block, L.gap(7), B.stachel, L.gap(5), B.probePad, L.gap(9),
          // Jump-Pad aufs Dach (Münze oben), danach ein Orb zum Ausprobieren
          B.padWand, L.gap(5), B.probeOrb, L.gap(8),
          // Der erste Orb, ohne den es nicht weitergeht
          B.orbFeld, L.gap(12),
          // Pad über Stacheln, danach zwei Deadlines
          B.padStacheln, L.gap(10), B.stachel, L.gap(7), B.stachel, L.gap(7),
          // Praxisphase beim Partnerunternehmen (Münze unter dem Tisch)
          B.praxisphaseProjekt, L.gap(12),
          // Bürotische und Zwischenpräsentation
          B.bueroTische, L.gap(12), B.hoersaalStufen, L.gap(8), B.stachel, L.gap(13),
          // Finale: Orb-Kette (der zweite Orb führt zur Münze), dann die letzten Deadlines
          B.orbKette, L.gap(8), B.stachel, L.gap(7), B.block, L.gap(5), B.doppelstachelStapel, L.gap(AUSLAUF)
        )
      }
    ]
  };
})();
