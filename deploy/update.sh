#!/usr/bin/env sh
# update.sh – neuen Stand aus GitHub holen und neu starten.
#   ./deploy/update.sh            (Docker Compose, Standard)
#   ./deploy/update.sh systemd    (ohne Docker, systemd-Dienst "studysim")
set -eu

cd "$(dirname "$0")/.."
MODE="${1:-docker}"
PORT="${PORT:-2223}"

case "$MODE" in
  docker) ;;
  systemd) command -v curl >/dev/null 2>&1 || { echo "curl fehlt (z. B. sudo apt install curl)" >&2; exit 1; } ;;
  *) echo "Unbekannter Modus: $MODE (erlaubt: docker, systemd)" >&2; exit 2 ;;
esac

echo "→ git pull"
git pull --ff-only

if [ "$MODE" = "docker" ]; then
  echo "→ docker compose build --pull (holt auch Sicherheitsupdates für Node/Alpine)"
  docker compose build --pull
  docker compose up -d
  docker image prune -f >/dev/null 2>&1 || true
else
  echo "→ systemctl restart studysim"
  sudo systemctl restart studysim
fi

# Gesundheitscheck: Docker prüft im Container (unabhängig vom Host-Port), systemd über curl
is_healthy() {
  if [ "$MODE" = "docker" ]; then
    docker compose exec -T studysim sh -c 'wget -qO /dev/null "http://127.0.0.1:${PORT:-2223}/healthz"' >/dev/null 2>&1
  else
    curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1
  fi
}

echo "→ warte auf /healthz"
i=0
while [ "$i" -lt 30 ]; do
  if is_healthy; then
    echo "✔ Studiums-Simulator läuft"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "✘ /healthz antwortet nicht" >&2
if [ "$MODE" = "docker" ]; then docker compose logs --tail 50 studysim >&2 || true; else sudo journalctl -u studysim -n 50 --no-pager >&2 || true; fi
exit 1
