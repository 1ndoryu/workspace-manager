#!/usr/bin/env bash
# Escritorio ligero (LXQt) de la VPS 89, desde el navegador del laptop.
# [por que] En la 89 solo escucha 127.0.0.1 (5901 VNC, 6080 noVNC): el tunel SSH es la unica
# entrada, asi que no se expone ningun puerto ni se usan contrasenas (dev y ubuntu las tienen
# bloqueadas por diseno). Uso:  escritorio-89.sh [--solo-tunel | --cerrar]
set -euo pipefail

ALIAS=dev89
PUERTO_LOCAL=6090
PUERTO_REMOTO=6080
URL="http://localhost:$PUERTO_LOCAL"
PIDFILE=/c/tmp/escritorio-89.pid

respuesta() { curl -s -o /dev/null --max-time 3 "$URL"; }

cerrar() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  echo "Tunel cerrado."
}

case "${1:-}" in
  --cerrar) cerrar; exit 0 ;;
  --solo-tunel) ABRIR=0 ;;
  "") ABRIR=1 ;;
  *) echo "Uso: $(basename "$0") [--solo-tunel | --cerrar]" >&2; exit 2 ;;
esac

if ! respuesta; then
  mkdir -p "$(dirname "$PIDFILE")"
  ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -L "$PUERTO_LOCAL:127.0.0.1:$PUERTO_REMOTO" "$ALIAS" &
  echo $! > "$PIDFILE"
  disown
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    respuesta && break
    sleep 0.5
  done
fi

if ! respuesta; then
  echo "El escritorio no responde en $URL." >&2
  echo "En la 89: systemctl status escritorio-vnc.service escritorio-web.service" >&2
  exit 1
fi

echo "Escritorio de la 89 disponible en $URL"
[ "$ABRIR" -eq 1 ] && { cmd.exe /c start "" "$URL" >/dev/null 2>&1 || true; }
exit 0
