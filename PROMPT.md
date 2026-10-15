# Prompt (Vibe-Coding-Workshop, Teil 1)

Das Spiel wurde mit KI (Claude Code) generiert. Ausgangsprompt:

> Erstelle einen extra Ordner, in dem du drin arbeitest. Erstelle das als Spiel. Studiums-Simulator:
> - Geometry Dash/Mario Party mit Side Quests
> - Einloggen/Einrichten von Edu/Easyroam
> - Nachklausuren
> - Wasserspender kaputt/funktioniert nur manchmal/CO2 fehlt
> - Mündliche Projektarbeitsprüfung

Nachgeschärft im Dialog mit der KI:

> Erstelle es unabhängig von meinen persönlichen Notizen, generell und abgekoppelt von mir.

Auf Rückfragen der KI hin festgelegt:

- Struktur: **Runner als Hauptspiel**, also ein langes Geometry-Dash-Level durchs Semester, bei dem Side Quests den Lauf an Checkpoints unterbrechen.
- Spieler: **nur Singleplayer**
- Code: **mehrere Dateien**, eine pro Szene (statt einer einzigen `index.html`)
- Technik laut Aufgabenstellung: JavaScript mit Phaser.js (Phaser 3), DHBW-Bezug, keine externen Assets

Die KI hat daraus das Design entworfen (siehe `README.md` und `docs/ARCHITECTURE.md`). Den Kern (Physik, Level-Format, Spielstand, UI-Bausteine) hat sie selbst geschrieben, die Szenen von parallel arbeitenden KI-Agents bauen lassen. Getestet wurde automatisiert im Headless-Browser.
