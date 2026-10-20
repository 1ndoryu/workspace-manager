#!/usr/bin/env bash
# Vigilante de los proyectos supervisados de la 89. Lo lanza el crontab de `dev` con `@reboot`
# y cada minuto: cubre el arranque tras un reinicio y la caida del propio bucle de reinicio.
# [por que] No sabe arrancar proyectos: repite lo que `Arranque up` grabo en
# ~/.local/share/taller/supervisar/<sesion>.sh. Duplicar aqui la logica de arranque seria una via
# paralela al wrapper, sin cm-heavy, sin el target del taller y sin las protecciones de cm-sweep
# (AGENTS §2). Este script solo mira si falta la sesion tmux y la vuelve a crear igual.
# [por que] El registro no se evalua con `source`: se leen cuatro lineas de base64 con un `sed` de
# lista blanca. Un archivo que se lee con `source` es codigo ejecutandose con los permisos de `dev`.
set -u

export PATH="$HOME/.local/bin:/usr/bin:/bin"
DIR_REGISTROS="$HOME/.local/share/taller/supervisar"
LOG="$HOME/taller/_logs/taller-vigilante.log"
LIMITE_LOG=10485760

mkdir -p "$DIR_REGISTROS" "$(dirname "$LOG")"

# Rotacion simple: el disco de la 89 es compartido.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt "$LIMITE_LOG" ]; then
  mv -f "$LOG" "$LOG.1"
fi

# Valor de una linea `CLAVE='base64'`. Solo base64: cualquier otra cosa se ignora.
valor() {
  sed -n "s/^$1='\([A-Za-z0-9+/=]*\)'\$/\1/p" "$2" | head -1
}

for registro in "$DIR_REGISTROS"/*.sh; do
  [ -f "$registro" ] || continue
  sesion=$(valor SESION "$registro" | base64 -d 2>/dev/null)
  dir=$(valor DIR "$registro" | base64 -d 2>/dev/null)
  argumento=$(valor ARGUMENTO "$registro" | base64 -d 2>/dev/null)
  proyecto=$(valor PROYECTO "$registro" | base64 -d 2>/dev/null)
  puerto=$(valor PUERTO "$registro" | base64 -d 2>/dev/null)
  # Un registro a medias no se adivina: se avisa y se deja quieto.
  if [ -z "$sesion" ] || [ -z "$dir" ] || [ -z "$argumento" ]; then
    echo "$(date -Is) registro ilegible, se ignora: $registro" >> "$LOG"
    continue
  fi
  # La sesion existe = el proceso esta vivo: `up` crea la sesion y el bucle de dentro no termina
  # nunca, asi que una sesion viva con el proceso muerto no es un estado posible.
  tmux has-session -t "$sesion" 2>/dev/null && continue
  # El directorio del proyecto puede faltar si el sync de Mutagen no ha llegado todavia: se
  # reintenta en el siguiente minuto en vez de crear una sesion que moriria al instante.
  if [ ! -d "$dir" ]; then
    echo "$(date -Is) $proyecto (puerto $puerto): falta el directorio $dir; se reintenta al minuto" >> "$LOG"
    continue
  fi
  tmux new-session -d -s "$sesion" -c "$dir" "$argumento" 2>>"$LOG" \
    && echo "$(date -Is) $proyecto (puerto $puerto): sesion $sesion recreada" >> "$LOG" \
    || echo "$(date -Is) $proyecto (puerto $puerto): no se pudo recrear $sesion" >> "$LOG"
done
