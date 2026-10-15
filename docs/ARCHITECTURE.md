# Studiums-Simulator – Architektur und Schnittstellen

Ein Semester an der DHBW als Geometry-Dash-Level (Singleplayer). Der Würfel-Studi
läuft automatisch, Crashes sind Nachklausuren, an den Checkpoints warten Side Quests.

## Grundregeln

- **Phaser 3.90** (keine Phaser-4-APIs), geladen von `src/phaser-loader.js`: per Doppelklick (file://)
  vom CDN mit Fallback `vendor/phaser.min.js`, gehostet (http/https) immer aus `vendor/`.
- **Hosting:** `deploy/server.mjs` liefert nur `index.html`, `css/`, `src/`, `vendor/`, `favicon.svg` und
  `og-image.png` aus. Neue Top-Level-Pfade dort (`PUBLIC_FILES`/`PUBLIC_DIRS`) und im `Dockerfile` (`COPY`) eintragen.
- **Klassische `<script>`-Dateien**, kein Build, keine ES-Module → Start per Doppelklick (file://).
  Reihenfolge steht in `index.html`. Neue Dateien müssen dort eingetragen werden.
- **Ein globaler Namensraum `SS`**. Szenen registrieren sich als `SS.scenes.<Key> = class extends Phaser.Scene`.
- **Keine externen Assets.** Texturen werden per Canvas-2D erzeugt:
  `SS.Textures.register(key, w, h, (ctx, w, h) => {...})` auf oberster Ebene der eigenen Datei.
  `BootScene` erzeugt alle Texturen, bevor irgendeine Szene startet (auch bei `?scene=`).
  Schlüssel-Präfixe: Runner `rn_`, eduroam `edu_`, Wasserspender `ws_`, Klausur `kl_`,
  Prüfung `pr_`, Menü/Zeugnis `ui_`. Gemeinsam: `px`, `dot`, `glow`, `spark`.
- **Alle Texte auf Deutsch** mit echten Umlauten. Humor ja, aber generisch: keine echten Personen,
  keine echten Firmen (außer DHBW), kein Bezug zu einzelnen Studierenden.
- Leinwand **800 × 600**, `Scale.FIT`. Wichtige UI mindestens 20 px vom Rand.
- Listener/Timer beim `shutdown` der Szene aufräumen (`SS.UI.onKey` macht das automatisch).

## Dateien

| Datei | Inhalt |
|---|---|
| `src/config.js` | `SS.CONFIG` (Maße, Physik, Farben, Themen, Schriften), `SS.getUrlParams()` |
| `src/core/state.js` | `SS.State`: Spielstand eines Semesters, Highscore (localStorage) |
| `src/core/physics.js` | `SS.Physics`: deterministische Runner-Physik (ohne Phaser) |
| `src/core/level.js` | `SS.Level`: ASCII-Level-Format, `parse`, `validate`, `join/gap/pit` |
| `src/core/textures.js` | `SS.Textures`: Textur-Registry |
| `src/core/audio.js` | `SS.Audio`: Soundeffekte + Musik per WebAudio |
| `src/core/ui.js` | `SS.UI`: Text, Button, Panel, Toast, Banner, Timer, Partikel |
| `src/core/sidequest.js` | `SS.SideQuest`: Intro-/Ergebniskarte, Rückkehr zur GameScene |
| `src/levels/semester.js` | `SS.Levels.semester`: das Level (4 Abschnitte) |
| `src/data/*.js` | Fragenkataloge (Klausur, Prüfung) unter `SS.Data` |
| `src/scenes/*.js` | eine Datei pro Szene |
| `tests/` | Node-Tests, Level-Prüfer, Headless-Browser-Tests |

## Szenenfluss

```
BootScene ─► MenuScene ─► GameScene (+ HudScene parallel)
                              │  Checkpoint am Abschnittsende:
                              │  scene.pause() + scene.launch(sideQuest, {sectionIndex})
                              ├─► EduroamScene        (nach Abschnitt 1)
                              ├─► WasserspenderScene  (nach Abschnitt 2)
                              ├─► KlausurScene        (nach Abschnitt 3)
                              └─► PruefungScene       (nach Abschnitt 4, Endboss)
                              │  Side Quest: SS.SideQuest.finish() → resume('GameScene', {sideQuestResult})
                              ▼
                        GameOverScene  (outcome: graduated | failed | exmatrikuliert)
Esc in der GameScene ─► PauseScene (über der pausierten GameScene)
Menü ─► Side Quest direkt (Übungsmodus, data.practice = true) ─► zurück ins Menü
```

## Spielregeln

- Crash = „Durchgefallen“: Neustart am Abschnittsanfang als Nachklausur.
  `SS.CONFIG.ATTEMPTS_PER_SECTION = 3` Versuche pro Abschnitt, danach **exmatrikuliert**.
- ECTS: 12 Münzen im Level (3 pro Abschnitt, je 1 ECTS) + Side Quests (max. 18) = **30 ECTS** maximal.
  Münzen eines Abschnitts zählen erst am Checkpoint (Crash setzt auf den Abschnittsanfang zurück).
- Side-Quest-Belohnungen (maximal): eduroam 3, Wasserspender 3, Klausur 6 (Nachklausur 4),
  Prüfung 6 (Note 1,0–1,7 → 6 · 2,0–2,7 → 5 · 3,0–3,7 → 4 · 4,0 → 3 · 5,0 → 0).
- Ende: Prüfungsnote ≤ 4,0 → `graduated`, sonst `failed`.

## Schnittstellen

### `SS.State`
`run` (Felder: `ects, ectsAtSectionStart, sectionIndex, attempt, deaths, sideQuests[], grade, outcome`),
`newRun()`, `jumpToSection(i)`, `addEcts(n)`, `registerDeath() → {attempt, attemptsLeft, exhausted}`,
`completeSection() → nächster Index`, `recordSideQuest(result)`, `finishRun(outcome)`, `elapsedSeconds()`,
`loadHighscore() → {bestEcts, bestGrade, runs, graduations}`, `saveHighscore() → {highscore, newBestEcts, newBestGrade}`,
`State.formatGrade(1.3) → "1,3"`, `State.roundGrade(raw)`, `State.Outcome.{GRADUATED, FAILED, EXMATRIKULIERT}`.

### `SS.Physics` und `SS.Level`
- `world = SS.Level.parse(SS.Levels.semester)` → `{tile, cols, width, levelWidth, isSolid(c,r), isPit(c), blocks[], objects[], coins[], triggers[], portals[], checkpoints[], sections[]}`.
  Objekte: `{type:'spike'|'coin'|'pad'|'orb', dir?, col, row, x, y, hx, hy, hw, hh, id, sectionIndex}`;
  Portale: `{type:'portal', kind:'praxis'|'theorie'|'fast'|'normal', x, y, id}`; Abschnitte: `{index, id, title, subtitle, theme, sideQuest, speed, startX, endX, startTriggerIdx}`.
- `p = SS.Physics.createPlayer({x, triggerIdx, speedMode})`, `SS.Physics.step(p, world, {jump}, SS.CONFIG.STEP, events)`.
  Events: `jump, land, pad, orb, coin{id}, portal{kind}, checkpoint{sectionIndex, sideQuest}, death{reason}, finish`.
- Physik: Sprunghöhe ≈ 2,2 Kacheln, Sprungweite ≈ 4 Kacheln (normal) bzw. ≈ 4,8 (schnell); Pad ≈ 4,2 Kacheln hoch.

### `SS.UI`
`text(scene, x, y, str, style, overrides)` mit Stilen `title, h1, h2, body, small, mono, hud`;
`background(scene, top, bottom)`; `panel(scene, x, y, w, h, opts)`;
`button(scene, x, y, label, onClick, {width, height, color, fontSize, key})` → Container mit `setEnabled/setLabel/press`;
`toast(scene, msg, opts)`; `banner(scene, title, subtitle, {duration, color, onDone})`;
`timerBar(scene, x, y, w, h, ms, {onDone})` → `{getRemaining, getFraction, addTime(±ms), pause, resume, stop, destroy}`;
`typewriter(scene, textObj, str, {cps, onDone})`; `fadeToScene(scene, key, data)`; `shake(scene, ms, intensity)`;
`burst(scene, x, y, opts)`; `confetti(scene, x, y)`; `onKey(scene, 'ENTER', fn)`.

### `SS.SideQuest`
`intro(scene, {title, subtitle, lines[], buttonLabel}, onStart)`, `outro(scene, result)`, `finish(scene, result)`,
`isPractice(scene)`. `result = {id, title, success, ects, message, grade?}`.

### `SS.Audio`
`unlock()`, `sfx(name)` mit `jump, coin, death, checkpoint, portal, pad, orb, click, success, fail, error, type, water, buzz, tick, win, lose`
(unbekannte Namen bleiben still), `music.play(track)` mit `menu, run, klausur, boss, sidequest` (unbekannter Track = Stille),
`music.stop()`, `music.current` (nur lesen!), `toggleMute()`, `setMuted(b)`, `isMuted()`, `status()` (Debug-Info).
Die Notation der Musik-Patterns steht am Anfang von Abschnitt 3 in `src/core/audio.js`.

### GameScene
`init(data)`: `{newRun = true, section = 0, god = false, timeScale = 1}`. `getHudInfo()` →
`{progress (0–1), sectionIndex, sectionTitle, phaseLabel ('Theoriephase'|'Praxisphase'), speedLabel, attempt}`
plus optional `sectionCount`, `sectionMarks` (Checkpoint-Positionen 0–1 für den Fortschrittsbalken) und `debugLabel`.
Startet `HudScene` parallel und beendet sie beim eigenen Shutdown.

Das `resume`-Event der GameScene kommt aus zwei Richtungen: Side Quests übergeben `{sideQuestResult}`,
die `PauseScene` setzt ohne Daten fort (Esc, P oder Enter). Ein Resume ohne `sideQuestResult` heißt einfach „weiterlaufen“.

### Hinweise zu `SS.UI`-Buttons
Buttons erkennen Klicks über eine unsichtbare `Zone`. Ein *klickbares* Abdunkelungs-Rechteck über
Buttons fängt deren Klicks ab. Overlays deshalb nicht interaktiv machen und darunterliegende Buttons
bei Bedarf mit `setVisible(false)` ausblenden.

## Debug-Parameter (URL)

- `?scene=EduroamScene` – BootScene startet die Szene direkt (Side Quests im Übungsmodus).
- `?scene=GameScene&section=2&god=1&speed=3` – Runner ab Abschnitt 3, unverwundbar, dreifaches Tempo.

## Tests

```bash
npm run test:unit      # Logik (State, Physik, Level-Parser)
npm run test:level     # jeder Abschnitt schaffbar? (Suche mit der echten Physik)
npm run test:smoke     # alle Szenen headless laden, Fehler sammeln, Screenshots
node tests/run-scene.mjs <Szene> --out screenshots/x.png --actions '[...]'
```
