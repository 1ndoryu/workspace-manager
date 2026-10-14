#!/usr/bin/env bash
# cm-sweep: limpieza periódica del VPS 89 (plan taller-remoto F5). Fuente única de verdad: este archivo.
# Instalar (idempotente): `cm-sweep --instalar` como root; lo llama provision-89.sh.
# Log: /var/log/cm-sweep.log. La última línea de cada corrida es el estado (OK o BLOQUEADO).
#
# Por qué así:
# - Targets /var/tmp/glory-target/<proyecto_rama>: se purgan si nada se escribió en UMBRAL_H horas
#   ("uso" = algún archivo con mtime reciente). Con techo por antigüedad. Nunca se purga un target
#   con un ejecutable suyo en marcha (un dev server que no escribe desde hace días sigue vivo).
# - Solo purga con el lock de cm-heavy tomado por nosotros: un build en marcha no pierde su target.
#   Si cm-heavy está ocupado, la parte de targets se omite (no espera: el timer vuelve en una hora).
# - Docker: caché de BuildKit por presupuesto y antigüedad; imágenes cm-local/* a IMG_POR_SITIO por sitio.
#   Un rmi falla si un contenedor usa la imagen: ese fallo es seguro y no se fuerza.
# - Suelo: si tras limpiar quedan menos de SUELO_GB libres, poda agresiva (targets no usados y toda la
#   caché de build). Si aun así no llega, la última línea es BLOQUEADO y cm-heavy se niega a compilar.
#   Los builds de Docker de Coolify no pasan por cm-heavy: esa parte queda fuera (ver plan F5).
# - sccache no está instalado en la 89: no se gestiona aquí.

set -uo pipefail

LOG=/var/log/cm-sweep.log
ESTADO=/var/lib/cm-sweep/estado
RAIZ=/var/tmp/glory-target
LOCK=/run/lock/cm-heavy.lock
UMBRAL_H=${CM_SWEEP_UMBRAL_H:-72}
TECHO_GB=${CM_SWEEP_TECHO_GB:-25}
BUILDX_GB=${CM_SWEEP_BUILDX_GB:-12}
BUILDX_H=${CM_SWEEP_BUILDX_H:-168}
IMG_POR_SITIO=${CM_SWEEP_IMG_POR_SITIO:-2}
SUELO_GB=${CM_SWEEP_SUELO_GB:-15}

if [[ "${1:-}" == --instalar ]]; then
  [[ "$(readlink -f "$0")" == /usr/local/sbin/cm-sweep ]] || install -m 755 "$0" /usr/local/sbin/cm-sweep
  install -d -m 755 /var/lib/cm-sweep
  cat > /etc/systemd/system/cm-sweep.service <<'EOF'
[Unit]
Description=Limpieza periódica del taller remoto (cm-sweep)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cm-sweep
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
bytes_de() { du -sb "$1" 2>/dev/null | cut -f1; }
en_uso() { find "$1" -mmin "-$((UMBRAL_H * 60))" -print -quit 2>/dev/null | grep -q .; }
ultima() { find "$1" -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1; }
ejecutable_en_marcha() {
  local e
  for e in /proc/[0-9]*/exe; do readlink "$e" 2>/dev/null; done | grep -q "^$1/"
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
  local img
  docker info >/dev/null 2>&1 || { log "docker: no responde, omitido"; return 0; }
  if docker buildx prune -f --max-used-space "${1}GB" --filter "until=${BUILDX_H}h" >/dev/null 2>&1; then
    log "docker: caché de build <= $1 GB y > ${BUILDX_H} h podada"
  else
    log "docker: buildx prune falló (ver docker buildx prune --help)"
  fi
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
podar_docker "$BUILDX_GB"
find /tmp/cm-builder -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf -- {} + 2>/dev/null
journalctl --vacuum-size=500M >/dev/null 2>&1
apt-get clean >/dev/null 2>&1

# 2. Suelo duro: poda agresiva si no llega
if (( $(libre_gb) < SUELO_GB )); then
  log "suelo: $(libre_gb) GB libres < $SUELO_GB GB; poda agresiva"
  purgar_targets 0
  docker buildx prune -af >/dev/null 2>&1 && log "docker: caché de build vaciada (suelo)"
fi

libre=$(libre_gb)
if (( libre < SUELO_GB )); then estado=BLOQUEADO; else estado=OK; fi
install -d -m 755 /var/lib/cm-sweep
echo "$estado libre=${libre}GB $(date +%s)" > "$ESTADO"
log "estado=$estado libre=${libre} GB (suelo ${SUELO_GB} GB, techo targets ${TECHO_GB} GB, umbral ${UMBRAL_H} h)"
