#!/usr/bin/env bash
# cm-sweep: limpieza periódica del VPS 89 (plan taller-remoto F5). Fuente única de verdad: este archivo.
# Instalar (idempotente): `cm-sweep --instalar` como root; lo llama provision-89.sh.
# Log: /var/log/cm-sweep.log. La última línea de cada corrida es el estado (OK o BLOQUEADO).
#
# Por qué así:
# - Targets $CM_TARGET_BASE/<proyecto_rama> (por defecto /var/tmp/glory-target): se purgan si nada se escribió en UMBRAL_H horas
#   ("uso" = algún archivo con mtime reciente). Con techo por antigüedad. Nunca se purga un target
#   con un ejecutable suyo en marcha (un dev server que no escribe desde hace días sigue vivo).
# - Solo purga con el lock de cm-heavy tomado por nosotros: un build en marcha no pierde su target.
#   Si cm-heavy está ocupado, la parte de targets se omite (no espera: el timer vuelve en una hora).
# - Docker: caché de BuildKit por presupuesto (techo), sin filtro de antigüedad, y midiendo el
#   tamaño real antes y después. El `--filter until=Nh` solo elige *candidatos*: si deja pocos,
#   BuildKit sale antes de llegar al techo y devuelve 0 igual, así que el log mentía. La
#   antigüedad ya la gobierna la política de GC de dockerd (`keepDuration` por defecto, 7 días).
#   Imágenes cm-local/* a IMG_POR_SITIO por sitio; un rmi falla si un contenedor usa la imagen:
#   ese fallo es seguro y no se fuerza.
# - `debug/incremental`: cargo crea un directorio nuevo por cada hash de parámetros de compilación
#   y no borra los viejos. Se conservan los 2 más recientes por crate, bajo el lock de cm-heavy.
# - Suelo: si tras limpiar quedan menos de SUELO_GB libres, poda agresiva (targets no usados y toda la
#   caché de build). Si aun así no llega, la última línea es BLOQUEADO y cm-heavy se niega a compilar.
#   Los builds de Docker de Coolify no pasan por cm-heavy: esa parte queda fuera (ver plan F5).
# - sccache no está instalado en la 89: no se gestiona aquí.

set -uo pipefail

LOG=/var/log/cm-sweep.log
ESTADO=/var/lib/cm-sweep/estado
# Raíz de los targets y tmp de builders: por defecto los de la 89; otro servidor los fija por entorno.
RAIZ=${CM_TARGET_BASE:-/var/tmp/glory-target}
BUILDER_TMP=${CM_BUILDER_TMP:-/tmp/cm-builder}
LOCK=/run/lock/cm-heavy.lock
UMBRAL_H=${CM_SWEEP_UMBRAL_H:-72}
TECHO_GB=${CM_SWEEP_TECHO_GB:-25}
BUILDX_GB=${CM_SWEEP_BUILDX_GB:-12}
IMG_POR_SITIO=${CM_SWEEP_IMG_POR_SITIO:-2}
SUELO_GB=${CM_SWEEP_SUELO_GB:-15}

if [[ "${1:-}" == --instalar ]]; then
  [[ "$(readlink -f "$0")" == /usr/local/sbin/cm-sweep ]] || install -m 755 "$0" /usr/local/sbin/cm-sweep
  install -d -m 755 /var/lib/cm-sweep
  # [por que] El servicio no hereda el entorno de quien instala: las rutas se fijan aquí, al instalar.
  cat > /etc/systemd/system/cm-sweep.service <<EOF
[Unit]
Description=Limpieza periódica del taller remoto (cm-sweep)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cm-sweep
Environment=CM_TARGET_BASE=$RAIZ
Environment=CM_BUILDER_TMP=$BUILDER_TMP
Nice=10
IOSchedulingClass=idle
EOF
  cat > /etc/systemd/system/cm-sweep.timer <<'EOF'
[Unit]
Description=cm-sweep cada hora

[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload && systemctl enable --now cm-sweep.timer
  echo "cm-sweep instalado: /usr/local/sbin/cm-sweep y cm-sweep.timer (horario)"
  exit 0
fi

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
libre_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }
gb() { awk -v b="${1:-0}" 'BEGIN { printf "%.2f", b / 1073741824 }'; }
# Para lo que viene de docker, que cuenta en SI: así el número del log y el techo hablan en la
# misma unidad (si no, "12.25 GB (techo 12 GB)" parece un error cuando no lo es).
gbsi() { awk -v b="${1:-0}" 'BEGIN { printf "%.2f", b / 1000000000 }'; }
bytes_de() { du -sb "$1" 2>/dev/null | cut -f1; }
en_uso() { find "$1" -mmin "-$((UMBRAL_H * 60))" -print -quit 2>/dev/null | grep -q .; }
ultima() { find "$1" -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1; }
ejecutable_en_marcha() {
  local e
  for e in /proc/[0-9]*/exe; do readlink "$e" 2>/dev/null; done | grep -q "^$1/"
}

# "13.15GB" -> bytes. Docker usa unidades SI en `system df` (1 GB = 10^9 B).
a_bytes() {
  awk -v s="${1:-0B}" 'BEGIN{
    u = substr(s, length(s) - 1, 2)
    if (u ~ /^[kMGT]B$/) { n = substr(s, 1, length(s) - 2) + 0 }
    else { u = "B"; n = substr(s, 1, length(s) - 1) + 0 }
    m = (u == "kB") ? 1e3 : (u == "MB") ? 1e6 : (u == "GB") ? 1e9 : (u == "TB") ? 1e12 : 1
    printf "%.0f", n * m
  }'
}

# Bytes que ocupa hoy la caché de BuildKit (0 si docker no responde).
cache_buildx() {
  local s
  s=$(docker system df --format '{{json .}}' 2>/dev/null \
        | grep '"Type":"Build Cache"' | grep -o '"Size":"[^"]*"' | cut -d'"' -f4)
  a_bytes "${s:-0B}"
}

# `debug/incremental` tiene dos niveles que se acumulan y ninguno se limpia solo:
#   incremental/<crate>-<hash>/<sesión>/…
# - Nivel 1: un `<crate>-<hash>` por cada hash de parámetros de compilación (el hash cambia, entre
#   otras cosas, según RUSTC_WRAPPER esté puesto o no). Medido el 2026-10-17: 52 directorios en
#   KAMPLES, 7,9 GB; 22 en MN, 1,36 GB.
# - Nivel 2: una carpeta de sesión por compilación dentro de cada uno.
# Se conservan los 2 más recientes de cada nivel: basta para no perder ninguna de las dos
# configuraciones que se alternan, y acota el resto. Bajo el lock de cm-heavy, así que nunca pisa
# un build en marcha.
limpiar_incremental() {
  local t inc c p n d antes desp total=0 configs=0 sesiones=0
  [[ -d "$RAIZ" ]] || return 0
  exec 8>>"$LOCK"
  if ! flock -n 8; then
    log "incremental: omitido, cm-heavy tiene el lock (build en marcha)"
    exec 8>&-
    return 0
  fi
  for t in "$RAIZ"/*/; do
    t=${t%/}; inc="$t/debug/incremental"
    [[ -d "$inc" ]] || continue
    antes=$(bytes_de "$inc"); antes=${antes:-0}

    for c in "$inc"/*/; do
      c=${c%/}
      [[ -d "$c" ]] || continue
      n=$(ls -1 "$c" 2>/dev/null | wc -l)
      (( n <= 2 )) && continue
      while read -r d; do rm -rf -- "$c/$d"; done < <(ls -1t "$c" | tail -n +3)
      sesiones=$(( sesiones + n - 2 ))
    done

    for p in $(for c in "$inc"/*/; do c=${c%/}; echo "${c##*/}"; done | sed 's/-[^-]*$//' | sort -u); do
      n=$(ls -1d "$inc/$p-"* 2>/dev/null | wc -l)
      (( n <= 2 )) && continue
      while read -r d; do rm -rf -- "$d"; done < <(ls -1dt "$inc/$p-"* 2>/dev/null | tail -n +3)
      configs=$(( configs + n - 2 ))
    done

    desp=$(bytes_de "$inc"); desp=${desp:-0}
    d=$(( antes - desp ))
    if (( d > 0 )); then
      total=$(( total + d ))
      log "incremental: $(basename "$t") $(gb "$antes") -> $(gb "$desp") GB"
    fi
  done
  flock -u 8
  exec 8>&-
  (( configs + sesiones > 0 )) && log "incremental: $configs configuraciones y $sesiones sesiones podadas, $(gb "$total") GB liberados"
  return 0
}

# $1 = techo en GB (0 = purga todo lo que no esté en uso). Devuelve 1 si no pudo tomar el lock.
purgar_targets() {
  local techo=$(( $1 * 1073741824 )) t u total
  [[ -d "$RAIZ" ]] || return 0
  exec 8>>"$LOCK"
  if ! flock -n 8; then
    log "targets: omitidos, cm-heavy tiene el lock (build en marcha)"
    exec 8>&-
    return 0
  fi
  for t in "$RAIZ"/*/; do
    t=${t%/}
    [[ -d "$t" ]] || continue
    if en_uso "$t"; then continue; fi
    if ejecutable_en_marcha "$t"; then log "targets: $(basename "$t") omitido, hay un ejecutable suyo en marcha"; continue; fi
    local antes; antes=$(bytes_de "$t")
    rm -rf -- "$t"
    log "targets: purga $(basename "$t") ($(gb "$antes") GB)"
  done
  total=$(bytes_de "$RAIZ"); total=${total:-0}
  if (( total > techo )); then
    while read -r _ t; do
      total=$(bytes_de "$RAIZ"); total=${total:-0}
      (( total <= techo )) && break
      ejecutable_en_marcha "$t" && continue
      rm -rf -- "$t"
      log "targets: techo $(( techo / 1073741824 )) GB, purga $(basename "$t")"
    done < <(for t in "$RAIZ"/*/; do t=${t%/}; u=$(ultima "$t"); printf '%s %s\n' "${u:-0}" "$t"; done | sort -n)
  fi
  flock -u 8
  exec 8>&-
}

podar_docker() {
  local img antes desp
  docker info >/dev/null 2>&1 || { log "docker: no responde, omitido"; return 0; }

  antes=$(cache_buildx)
  # Sin `--filter`: el techo es un presupuesto y BuildKit elige por LRU. Con filtro de antigüedad
  # solo poda los candidatos que pasan el filtro y puede rendirse antes del techo devolviendo 0.
  docker buildx prune -f --max-used-space "${1}GB" >/dev/null 2>&1
  desp=$(cache_buildx)
  log "docker: caché de build $(gbsi "$antes") -> $(gbsi "$desp") GB (techo $1 GB, poda LRU)"
  # BuildKit siempre deja un residuo que no puede desalojar (medido: 2 % sobre el techo), así que
  # solo se avisa si se pasa de verdad; un aviso que salta cada hora no avisa de nada.
  (( desp > $1 * 1000000000 * 115 / 100 )) && log "docker: aviso, la caché sigue por encima del techo tras la poda"

  docker image prune -f >/dev/null 2>&1
  docker images --filter 'reference=cm-local/*' --format '{{.Repository}}{{"\t"}}{{.Tag}}{{"\t"}}{{.CreatedAt}}' \
    | sort -t$'\t' -k1,1 -k3,3r \
    | awk -F'\t' -v n="$IMG_POR_SITIO" '{ c[$1]++; if (c[$1] > n) print $1 ":" $2 }' \
    | while read -r img; do
        docker rmi "$img" >/dev/null 2>&1 && log "docker: imagen $img retirada (más de $IMG_POR_SITIO por sitio)"
      done
}

# 1. Limpieza normal
purgar_targets "$TECHO_GB"
limpiar_incremental
podar_docker "$BUILDX_GB"
find "$BUILDER_TMP" -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf -- {} + 2>/dev/null
journalctl --vacuum-size=500M >/dev/null 2>&1
apt-get clean >/dev/null 2>&1

# 2. Suelo duro: poda agresiva si no llega
if (( $(libre_gb) < SUELO_GB )); then
  log "suelo: $(libre_gb) GB libres < $SUELO_GB GB; poda agresiva"
  purgar_targets 0
  limpiar_incremental
  antes=$(cache_buildx)
  docker buildx prune -af >/dev/null 2>&1
  log "docker: caché de build $(gb "$antes") -> $(gb "$(cache_buildx)") GB (vaciada por suelo)"
fi

libre=$(libre_gb)
if (( libre < SUELO_GB )); then estado=BLOQUEADO; else estado=OK; fi
install -d -m 755 /var/lib/cm-sweep
echo "$estado libre=${libre}GB $(date +%s)" > "$ESTADO"
log "estado=$estado libre=${libre} GB (suelo ${SUELO_GB} GB, techo targets ${TECHO_GB} GB, umbral ${UMBRAL_H} h)"
