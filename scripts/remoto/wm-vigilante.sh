#!/usr/bin/env bash
# Vigilante del manager en la VPS 89 (plan taller remoto F9.3). Lo lanza crontab de `dev`
# con `@reboot` y cada minuto. Sin root no hay unidad systemd con `enable-linger`, así que
# cron de usuario cubre el arranque tras reinicio y la reanudación tras una caída.
# [por que] Solo arranca si el PID guardado sigue siendo nuestro manager (línea de comando
# y directorio de trabajo), así que nunca mata ni toma procesos ajenos (AGENTS §5).
# No lee ni escribe el token: lo crea y lo usa el propio servidor.
set -u

export PATH="$HOME/.local/bin:/usr/bin:/bin"
RAIZ="${WM_RAIZ:-$HOME/taller/workspace-manager}"
AREA="${WS_AREA_ROOT:-$HOME/taller}"
PUERTO="${WS_PORT:-8787}"
DIR_ESTADO="$HOME/.workspace-manager"
PIDFILE="$DIR_ESTADO/server.pid"
LOG="$HOME/taller/_logs/workspace-manager/server.log"
LIMITE_LOG=10485760

mkdir -p "$DIR_ESTADO" "$(dirname "$LOG")"

# Verdadero si el PID guardado es un servidor del manager de esta raíz.
vivo() {
  local pid
  [ -f "$PIDFILE" ] || return 1
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'dist-server/server/index.js' || return 1
  [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$RAIZ" ] || return 1
  return 0
}

if vivo; then
  exit 0
fi

# Rotación simple: el log no crece sin límite en una VPS con disco compartido.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt "$LIMITE_LOG" ]; then
  mv -f "$LOG" "$LOG.1"
fi

cd "$RAIZ" || { echo "$(date -Is) raíz ausente: $RAIZ" >> "$LOG"; exit 1; }
[ -f dist-server/server/index.js ] || { echo "$(date -Is) falta el build del servidor" >> "$LOG"; exit 1; }

echo "$(date -Is) arranque del manager (puerto $PUERTO)" >> "$LOG"
WS_AREA_ROOT="$AREA" WS_PORT="$PUERTO" \
  setsid nohup node dist-server/server/index.js >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# Readiness: el endpoint sin token responde 200 en cuanto el servidor escucha.
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PUERTO/api/ping" 2>/dev/null; then
    echo "$(date -Is) manager listo en 127.0.0.1:$PUERTO (pid $(cat "$PIDFILE"))" >> "$LOG"
    exit 0
  fi
  sleep 1
done
echo "$(date -Is) el manager no respondió en 30 s; revisar este log" >> "$LOG"
exit 1
