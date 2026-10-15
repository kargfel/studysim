# Hosting auf dem Homeserver – studysim.felixkarg.de

```
Browser ──HTTPS──▶ Cloudflare ──Tunnel──▶ cloudflared ──▶ Traefik ──HTTP──▶ Studiums-Simulator :2223
```

HTTPS endet bei Cloudflare. Auf dem Server läuft das Spiel als kleiner Node-Webserver
(`deploy/server.mjs`, ohne Abhängigkeiten) auf **Port 2223**. Traefik leitet
`studysim.felixkarg.de` dorthin weiter.

Was der Server mitbringt:

- **Nur Spiel-Dateien öffentlich:** `index.html`, `css/`, `src/`, `vendor/`, Favicon und Vorschaubild.
  `.git`, `tests/`, `docs/` und alle anderen Pfade liefern 404.
- **Sicherheits-Header:** strikte Content-Security-Policy, `nosniff`, kein Einbetten in fremde Seiten.
- **Keine Anfragen an Dritte:** Gehostet lädt das Spiel Phaser aus `vendor/` statt vom CDN.
- **Cache-Busting:** Alle Skripte bekommen automatisch `?v=<Hash>`. Browser und Cloudflare dürfen
  sie lange cachen und laden nach einem Update trotzdem sofort den neuen Stand.
- **Komfort:** gzip, ETag/304 und ein Gesundheitscheck unter `/healthz`.

## 1. Voraussetzungen

- `git`
- **Variante A (empfohlen):** Docker mit Compose-Plugin (`docker compose version`)
- **Variante B:** Node.js ≥ 18 als Systempaket unter `/usr/bin/node` (nicht per nvm im Home-Verzeichnis)
- Traefik-Route `studysim.felixkarg.de` → Port 2223 und der Cloudflare-Tunnel
  (Published Application / Public Hostname). Beides hast du schon; Abschnitt 4 und 5 sind Checklisten dafür.

## 2. Variante A: Docker Compose

```bash
sudo git clone https://github.com/kargfel/studysim.git /opt/studysim
sudo chown -R "$USER": /opt/studysim
cd /opt/studysim
docker compose up -d --build
curl -fsS http://127.0.0.1:2223/healthz      # → ok
```

Der Container startet automatisch neu (`restart: unless-stopped`). Er läuft read-only,
ohne Root-Rechte und ohne Linux-Capabilities. Status und Logs:

```bash
docker compose ps          # STATUS sollte "healthy" zeigen
docker compose logs -f     # eine Zeile pro Anfrage
```

## 3. Variante B: ohne Docker (systemd)

```bash
sudo git clone https://github.com/kargfel/studysim.git /opt/studysim
sudo chown -R "$USER": /opt/studysim
cd /opt/studysim
node --version                                   # ≥ v18
sudo cp deploy/studysim.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now studysim
curl -fsS http://127.0.0.1:2223/healthz          # → ok
journalctl -u studysim -f                        # Logs
```

Liegt das Repo nicht unter `/opt/studysim` oder `node` nicht unter `/usr/bin/node`, passe die
Pfade in `/etc/systemd/system/studysim.service` an.

Schnelltest ohne Dienst: `PORT=2223 node deploy/server.mjs`

## 4. Checkliste Traefik

Traefik muss `studysim.felixkarg.de` an Port 2223 weitergeben. Je nachdem, wie Traefik läuft:

**Traefik direkt auf dem Host:** Ziel ist `http://127.0.0.1:2223`.

**Traefik im Docker-Container mit File-Provider** (z. B. `dynamic/studysim.yml`):

```yaml
http:
  routers:
    studysim:
      rule: Host(`studysim.felixkarg.de`)
      entryPoints: [web]          # der Entrypoint, an den der Tunnel liefert
      service: studysim
  services:
    studysim:
      loadBalancer:
        servers:
          - url: http://host.docker.internal:2223   # oder die LAN-IP des Servers
```

Unter Linux kennt der Traefik-Container `host.docker.internal` nur mit diesem Eintrag in
seiner Compose-Datei:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

**Traefik über Docker-Labels:** In `compose.yaml` steht eine auskommentierte Variante.
Dann `ports` entfernen und den Container in Traefiks Netzwerk hängen.

Test über Traefik, ohne Cloudflare (Port des Traefik-Entrypoints einsetzen, z. B. 80):

```bash
curl -fsS -H "Host: studysim.felixkarg.de" http://127.0.0.1:80/healthz     # → ok
```

## 5. Checkliste Cloudflare

- **Zero Trust → Networks → Tunnels → dein Tunnel → Published application routes:**
  `studysim.felixkarg.de` → Service zeigt auf **Traefik**, z. B. `http://traefik:80` oder `http://localhost:80`.
- **Redirect-Schleife vermeiden:** Leitet der Traefik-Entrypoint HTTP auf HTTPS um, entsteht mit
  einem HTTP-Tunnel eine Endlosschleife (`ERR_TOO_MANY_REDIRECTS`). Nimm für den Tunnel einen
  Entrypoint ohne Redirect, oder lass den Tunnel `https://traefik:443` ansprechen
  (TLS-Einstellungen: *No TLS Verify* bzw. *Origin Server Name* `studysim.felixkarg.de`).
- **HTTPS:** stellt Cloudflare automatisch bereit. Empfehlenswert: *SSL/TLS → Edge Certificates → Always Use HTTPS*.
- **Cache:** Wegen des Cache-Bustings ist nach Updates kein Leeren nötig. Wirkt doch etwas veraltet,
  hilft *Caching → Configuration → Purge Everything*.

Danach im Browser: <https://studysim.felixkarg.de> und <https://studysim.felixkarg.de/healthz> (→ `ok`).

## 6. Updates einspielen

```bash
cd /opt/studysim
./deploy/update.sh            # Variante A: git pull, Image neu bauen, auf /healthz warten
./deploy/update.sh systemd    # Variante B: git pull, Dienst neu starten
```

## 7. Fehlersuche

| Symptom | Wahrscheinliche Ursache | Prüfen / Lösung |
|---|---|---|
| `curl 127.0.0.1:2223/healthz` schlägt fehl | Server läuft nicht | `docker compose ps` / `docker compose logs` bzw. `systemctl status studysim` |
| Port 2223 belegt | anderer Dienst | `sudo ss -ltnp \| grep 2223`; Port in `compose.yaml` und in Traefik gleich ändern |
| 502 Bad Gateway (von Traefik) | Traefik erreicht Port 2223 nicht | Ziel-URL in Traefik prüfen (Abschnitt 4); aus dem Container testen: `docker exec <traefik> wget -qO- http://host.docker.internal:2223/healthz`; Firewall: Zugriff aus dem Docker-Netz auf 2223 erlauben |
| 404 von Traefik | Router passt nicht | `Host(...)`-Regel und Entrypoint prüfen; Test mit `curl -H "Host: …"` (Abschnitt 4) |
| Cloudflare-Fehler 1033 oder 502 | Tunnel offline oder falsches Ziel | `cloudflared`-Status, Service-URL der Route |
| `ERR_TOO_MANY_REDIRECTS` | HTTPS-Redirect in Traefik und Tunnel per HTTP | siehe Abschnitt 5 |
| Schwarzer Bildschirm | JavaScript-Fehler | Browser-Konsole (F12) und Server-Logs ansehen |
| Nach Update alter Stand | Image nicht neu gebaut | `./deploy/update.sh`, notfalls Cloudflare-Cache leeren |

## 8. Gut zu wissen

- Das Spiel setzt keine Cookies. Highscore und Ton-Einstellung liegen nur im `localStorage` des Browsers.
- Wird die Seite öffentlich beworben, prüfe, ob du ein Impressum und eine Datenschutzerklärung brauchst
  (Cloudflare verarbeitet als Proxy die IP-Adressen der Besucher).
- Lokal testen, ganz ohne Server: `index.html` per Doppelklick öffnen. Mit Server: `npm start`, dann <http://localhost:2223>.
- Der Server wird automatisch getestet: `npm run test:hosting` prüft Header, Zugriffsschutz und den Spielstart im Browser.
