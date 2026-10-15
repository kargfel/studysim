#!/usr/bin/env sh
# update.sh – neuen Stand aus GitHub holen und neu starten.
#   ./deploy/update.sh            (Docker Compose, Standard)
#   ./deploy/update.sh systemd    (ohne Docker, systemd-Dienst "studysim")
set -eu

cd "$(dirname "$0")/.."
MODE="${1:-docker}"
PORT="${PORT:-2223}"

echo "→ git pull"
git pull --ff-only

case "$MODE" in
  docker)
    echo "→ docker compose up -d --build"
    docker compose up -d --build
    docker image prune -f >/dev/null 2>&1 || true
    ;;
  systemd)
    echo "→ systemctl restart studysim"
    sudo systemctl restart studysim
    ;;
  *)
    echo "Unbekannter Modus: $MODE (erlaubt: docker, systemd)" >&2
    exit 2
    ;;
esac

echo "→ warte auf http://127.0.0.1:$PORT/healthz"
i=0
while [ "$i" -lt 30 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "✔ Studiums-Simulator läuft (Port $PORT)"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "✘ /healthz antwortet nicht" >&2
if [ "$MODE" = "docker" ]; then docker compose logs --tail 50 studysim >&2 || true; else sudo journalctl -u studysim -n 50 --no-pager >&2 || true; fi
exit 1
