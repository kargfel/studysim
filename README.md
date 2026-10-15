# Studiums-Simulator · Semester Dash (DHBW Edition)

Ein Semester an der DHBW als Geometry-Dash-Level. Dein Würfel-Studi rennt automatisch durch
Campus, Hörsaal, Klausurenphase und Projektphase. Wer crasht, fällt durch und schreibt
eine Nachklausur. An jedem Checkpoint wartet eine Side Quest, und am Ende sitzt die
Prüfungskommission.

## Starten

`index.html` per Doppelklick öffnen. Mehr braucht es nicht: kein Server, kein Build.
Phaser 3.90 kommt vom CDN. Ohne Internet lädt automatisch die lokale Kopie aus `vendor/`.

## Steuerung

| Aktion | Taste |
|---|---|
| Springen (gedrückt halten = Dauersprung) | Leertaste, ↑, W, Mausklick oder Touch |
| Sprung-Orb in der Luft auslösen | Springen, während der Würfel den Orb berührt |
| Pause | Esc oder P |
| Ton an/aus | M |
| Side Quests | Maus, Ziffern 1–4, Enter |

## Regeln

- **Nachklausuren:** Ein Crash heißt „Durchgefallen“. Du startest neu am Anfang des Abschnitts.
  Jeder Abschnitt hat 3 Versuche (Erstversuch und zwei Nachklausuren). Danach bist du **exmatrikuliert**.
- **Duales Studium:** Das Praxis-Portal stellt die Welt auf den Kopf, und du läufst an der Decke.
  Das Theorie-Portal holt dich zurück. In der Klausurenphase läuft alles schneller.
- **ECTS:** Pro Abschnitt liegen 3 ECTS-Münzen. Sie zählen erst am Checkpoint.
  Dazu kommen die Side Quests. Ein perfektes Semester bringt **30 ECTS**.

| Abschnitt | Side Quest danach | max. ECTS |
|---|---|---|
| 1 · Semesterstart (Campus) | **eduroam einrichten:** WLAN wählen, easyroam, 2FA-Code, abgelaufenes Zertifikat | 3 |
| 2 · Vorlesungszeit (mit Praxisphase) | **Wasserspender:** Flasche füllen, obwohl er tröpfelt, streikt oder kein CO₂ mehr hat | 3 |
| 3 · Klausurenphase (schnell) | **Klausur:** Quiz unter Zeitdruck, bei Durchfallen direkt die Nachklausur | 6 |
| 4 · Projektphase | **Mündliche Projektarbeitsprüfung (Endboss):** Fragen der Kommission, Nervosität, Beamer ohne Signal | 6 |

Im Menü lassen sich alle Side Quests einzeln üben.

## Projektstruktur

```
index.html            lädt Phaser und alle Skripte (klassische <script>-Tags, kein Build)
css/style.css
vendor/phaser.min.js  Phaser 3.90.0 als Offline-Fallback
src/config.js         alle Konstanten (Maße, Physik, Farben, Themen)
src/core/             Spiellogik ohne Phaser + gemeinsame Bausteine
  state.js            Spielstand und Highscore
  physics.js          deterministische Runner-Physik
  level.js            ASCII-Level-Format, Parser und Validierung
  textures.js         prozedurale Texturen (Canvas)
  audio.js            Soundeffekte und Musik per WebAudio
  ui.js               Buttons, Panels, Banner, Timer, Partikel
  sidequest.js        gemeinsamer Ablauf aller Side Quests
src/levels/semester.js  das Level, aus lesbaren ASCII-Bausteinen zusammengesetzt
src/data/             Fragenkataloge (Klausur, Prüfung)
src/scenes/           eine Datei pro Szene
tests/                Unit-Tests, Level-Prüfer, Headless-Browser-Tests
docs/ARCHITECTURE.md  Schnittstellen und Szenenfluss
```

Das Level steht als ASCII-Art in `src/levels/semester.js`, zum Beispiel:

```
'  o ',     o  ECTS-Münze
' ## ',     #  Block
'^  ^',     ^  Stachel (Deadline)
'===_'      =  Boden, _ Grube
```

## Tests

Einmalig `npm install` ausführen. Das installiert nur `playwright-core`; genutzt wird ein bereits vorhandenes Chromium.

```bash
npm run test:unit    # Spiellogik (Physik, Spielstand, Level-Parser)
npm run test:level   # Ist jeder Abschnitt schaffbar? Der Prüfer durchsucht alle Eingabefolgen mit der echten Physik.
npm run test:smoke   # Headless-Browser: alle Szenen, kompletter Durchlauf, Exmatrikulation, Pause und Screenshots
npm run zip          # dist/Spiel.zip für die Abgabe
```

Debug-Parameter für den Browser:

- `index.html?scene=KlausurScene` startet direkt eine Szene.
- `index.html?scene=GameScene&section=1&god=1&speed=2` startet den Runner ab Abschnitt 2, unverwundbar und mit doppeltem Tempo.

## Entstehung

Das Spiel ist im Vibe-Coding-Workshop („Neue Konzepte der Informatik“) mit KI-Unterstützung (Claude Code) entstanden.
Den Prompt findest du in `PROMPT.md`.
