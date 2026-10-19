#!/usr/bin/env bash
# Escritorio ligero (LXQt) de la VPS 89, desde el navegador del laptop.
# [por que] En la 89 solo escucha 127.0.0.1 (5901 VNC, 6080 noVNC): el tunel SSH es la unica
# entrada, asi que no se expone ningun puerto ni se usan contrasenas (dev y ubuntu las tienen
# bloqueadas por diseno). El tunel va desligado del terminal (`ssh -f` + socket de control) para
# que sobreviva al cierre del shell; un `ssh ... &` en Git Bash se muere con la consola.
# Uso: escritorio-89.sh [--solo-tunel | --cerrar]
set -euo pipefail

# El alias SSH del taller no va incrustado: sale de la config privada
# (config/taller.json), que se puede mover con WS_CONFIG_ROOT. WM_HOST lo pisa
# para una prueba puntual. Mismo patrón que build-remoto.sh.
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FICHA="${WS_CONFIG_ROOT:-$RAIZ/config}/taller.json"
if [ -n "${WM_HOST:-}" ]; then
  ALIAS="$WM_HOST"
elif [ -f "$FICHA" ]; then
  # Git Bash da rutas /c/... que el node de Windows no resuelve: se traducen.
  FICHA_NODE="$FICHA"
  command -v cygpath >/dev/null 2>&1 && FICHA_NODE="$(cygpath -w "$FICHA")"
  ALIAS="$(node -e 'process.stdout.write(require(process.argv[1]).host || "")' "$FICHA_NODE" 2>/dev/null || true)"
else
  echo "escritorio-89: falta $FICHA (copia config/ejemplos/taller.example.json) o define WM_HOST" >&2
  exit 3
fi
[ -n "$ALIAS" ] || { echo "escritorio-89: $FICHA no declara 'host'; define WM_HOST" >&2; exit 3; }

# Puertos por entorno: por defecto 6090/6080; cambiar solo si chocan en la laptop o en la 89.
PUERTO_LOCAL=${WM_ESCRITORIO_PUERTO:-6090}
PUERTO_REMOTO=${WM_ESCRITORIO_PUERTO_REMOTO:-6080}
URL="http://localhost:$PUERTO_LOCAL"
SOCK="${WM_TMP:-/c/tmp}/escritorio-89.sock"

respuesta() { curl -s -o /dev/null --max-time 3 "$URL"; }
vivo() { ssh -O check -o ControlPath="$SOCK" "$ALIAS" >/dev/null 2>&1; }

cerrar() {
  if vivo; then
    ssh -O exit -o ControlPath="$SOCK" "$ALIAS" >/dev/null 2>&1 || true
    echo "Tunel cerrado."
  else
    echo "No habia tunel abierto por este script."
  fi
  rm -f "$SOCK"
}

case "${1:-}" in
  --cerrar) cerrar; exit 0 ;;
  --solo-tunel) ABRIR=0 ;;
  "") ABRIR=1 ;;
  *) echo "Uso: $(basename "$0") [--solo-tunel | --cerrar]" >&2; exit 2 ;;
esac

if ! vivo; then
  mkdir -p "$(dirname "$SOCK")"
  rm -f "$SOCK"
  ssh -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ControlMaster=yes -o ControlPath="$SOCK" \
    -L "$PUERTO_LOCAL:127.0.0.1:$PUERTO_REMOTO" "$ALIAS"
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  respuesta && break
  sleep 0.5
done

if ! respuesta; then
  echo "El escritorio no responde en $URL." >&2
  echo "En la 89: systemctl status escritorio-vnc.service escritorio-web.service" >&2
  exit 1
fi

echo "Escritorio de la 89 disponible en $URL"
if [ "$ABRIR" -eq 1 ]; then
  cmd.exe /c start "" "$URL" >/dev/null 2>&1 || true
fi
exit 0
