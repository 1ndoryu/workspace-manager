#!/usr/bin/env bash
# cm-sweep: limpieza periódica del VPS 89 (plan taller-remoto F5). Fuente única de verdad: este archivo.
# Instalar (idempotente): `cm-sweep --instalar` como root; lo llama provision-89.sh.
# Uso: cm-sweep [--dry-run]   — `--dry-run` imprime lo que borraría y no borra nada.
# Log: /var/log/cm-sweep.log. La última línea de cada corrida es el estado (OK o BLOQUEADO).
#
# Reglas de oro (v2, plan 19AA-5):
# - **Nada en uso se toca.** Al empezar se construye un mapa con el cwd, el ejecutable y los
#   ficheros abiertos de todos los procesos (/proc) y TODO borrado pasa por él. El mtime decide
#   solo *antigüedad*, nunca seguridad: un dev server que no escribe desde hace días sigue vivo.
# - **Lista cerrada de objetivos.** No hay `find /`. Cada objetivo declara ruta, hoja obligatoria
#   (si el último componente no es el esperado, no se limpia: fail-closed) y umbral.
# - **Datos fuera de alcance:** *.dump, *.sql, *.sqlite*, *.tar*, *.gz, *.xz, *.zst, cualquier
#   checkout con cambios sin commitear, y las rutas de $NUNCA.
# - **Si cm-heavy tiene el lock, la corrida no se omite:** se hace todo lo que no necesita el lock
#   (docker, /tmp, /var/tmp ajeno, cachés de casa), que es justo lo que hoy se quedaba sin limpiar
#   cuando un build llenaba el disco.
#
# Por qué así:
# - Targets $CM_TARGET_BASE/<proyecto_rama> (por defecto /var/tmp/glory-target): se purgan por
#   antigüedad y por techo, bajo el lock de cm-heavy (un build en marcha no pierde su target).
# - `debug/incremental`: cargo crea un directorio nuevo por hash de parámetros y no borra los
#   viejos. Se conservan los 2 más recientes por crate y por configuración.
# - Docker: caché de BuildKit por presupuesto (techo). El `--filter until=Nh` solo elige
#   *candidatos*: si deja pocos, BuildKit sale antes de llegar al techo y devuelve 0, así que el
#   log mentía. La antigüedad ya la gobierna la política de GC de dockerd (keepDuration, 7 días).
#   Imágenes cm-local/* a IMG_POR_SITIO por sitio; un rmi falla si un contenedor usa la imagen:
#   ese fallo es seguro y no se fuerza.
# - Niveles: 0 mantenimiento (>= OBJETIVO_GB libres), 1 aviso (< OBJETIVO_GB) y 2 suelo
#   (< SUELO_GB). Una corrida que no llega al objetivo repite la pasada de basura sin umbrales,
#   sin esperar a la siguiente: así el suelo deja de tocarse.
# - Suelo: si aun así no llega, la última línea es BLOQUEADO y cm-heavy se niega a compilar.
#   Los builds de Docker de Coolify no pasan por cm-heavy: esa parte queda fuera (ver plan F5).

set -uo pipefail

LOG=${CM_SWEEP_LOG:-/var/log/cm-sweep.log} # parametrizable para probar sin ensuciar el log real
ESTADO=${CM_SWEEP_ESTADO:-/var/lib/cm-sweep/estado}
# Rutas: por defecto las de la 89; otro servidor las fija por entorno (el unit las propaga).
RAIZ=${CM_TARGET_BASE:-/var/tmp/glory-target}
CALIDAD=${CM_QUALITY_BASE:-/var/tmp/glory-quality}
VTMP=${CM_VAR_TMP:-/var/tmp}
TMPD=${CM_TMP:-/tmp}
# [por que] Antes era /home/usuario incrustado: el usuario de una máquina concreta. Por defecto es el
# HOME del usuario que corre el barrido; `:?` aborta si no hay HOME (fail-closed: esta ruta alimenta NUNCA).
CASA=${CM_SWEEP_CASA:-${HOME:?sin HOME: define CM_SWEEP_CASA}}
# Hoja obligatoria de cada raíz: si el último componente no es este, el objetivo no se toca
# (fail-closed). Es lo que impide que una variable de entorno mal puesta borre un directorio que no
# es el suyo; va aparte de la ruta para que siga sirviendo al cambiar de servidor.
HOJA_TARGET=${CM_SWEEP_HOJA_TARGET:-glory-target}
HOJA_CALIDAD=${CM_SWEEP_HOJA_CALIDAD:-glory-quality}
LOCK=${CM_SWEEP_LOCK:-/run/lock/cm-heavy.lock} # parametrizable: los señuelos lo mueven a su caja
# Umbrales y presupuesto (D5): con techos 20+10+13+20+15 = 78 GB en un disco de 96 sobran 18 GB.
OBJETIVO_GB=${CM_SWEEP_OBJETIVO_GB:-25}
SUELO_GB=${CM_SWEEP_SUELO_GB:-15}
TECHO_GB=${CM_SWEEP_TECHO_GB:-20}
BUILDX_GB=${CM_SWEEP_BUILDX_GB:-10}
IMG_POR_SITIO=${CM_SWEEP_IMG_POR_SITIO:-2}
UMBRAL_H=${CM_SWEEP_UMBRAL_H:-48}
# En el suelo se espera al lock antes de rendirse: es la corrida en la que importa podar targets.
ESPERA_LOCK_S=${CM_SWEEP_ESPERA_LOCK_S:-180}
CALIDAD_POR_HERRAMIENTA=${CM_SWEEP_CALIDAD_POR_HERRAMIENTA:-1}
JOURNAL_MB=${CM_SWEEP_JOURNAL_MB:-500}
DRY=0
# AMPLIO=1 cuando /tmp entra entero (nivel 2 o segunda pasada): fuera de eso solo se tocan las
# familias conocidas, que es la lista cerrada.
AMPLIO=0
BORRADOS=0
LIBERADO=0
# Rutas que no se tocan nunca, ni en el suelo (D3).
NUNCA="/etc /usr /boot /run /dev/shm /proc /sys /var/lib /var/log /var/spool ${CASA}/taller \
${CASA}/.mutagen ${CASA}/.cargo ${CASA}/.rustup ${CASA}/.claude ${CASA}/.config ${CASA}/.local \
${CASA}/bin ${CASA}/.npm/_logs ${CASA}/.ssh ${CASA}/.gnupg"

if [[ "${1:-}" == --instalar ]]; then
  [[ "$(readlink -f "$0")" == /usr/local/sbin/cm-sweep ]] || install -m 755 "$0" /usr/local/sbin/cm-sweep
  install -d -m 755 "${ESTADO%/*}"
  # [por que] El servicio no hereda el entorno de quien instala: las rutas se fijan aquí, al instalar.
  cat > /etc/systemd/system/cm-sweep.service <<EOF
[Unit]
Description=Limpieza periódica del taller remoto (cm-sweep)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cm-sweep
Environment=CM_TARGET_BASE=$RAIZ
Environment=CM_QUALITY_BASE=$CALIDAD
Environment=CM_SWEEP_CASA=$CASA
Nice=10
IOSchedulingClass=idle
EOF
  # Cada 15 min: la corrida cuesta segundos y el disco se mueve en minutos, no en horas.
  cat > /etc/systemd/system/cm-sweep.timer <<'EOF'
[Unit]
Description=cm-sweep cada 15 minutos

[Timer]
OnCalendar=*:0/15
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload && systemctl enable --now cm-sweep.timer
  echo "cm-sweep instalado: /usr/local/sbin/cm-sweep y cm-sweep.timer (cada 15 min)"
  exit 0
fi

if [[ "${1:-}" == --ayuda || "${1:-}" == -h || "${1:-}" == --help ]]; then
  sed -n '2,10p' "$0" | cut -c3-
  exit 0
fi

[[ "${1:-}" == --dry-run || "${1:-}" == -n ]] && DRY=1

# Sin `date` ni `tee`: son dos procesos por línea y en una pasada de /tmp hay miles (medido: 36 s
# de los que ~30 eran esto). `printf -v` con `%()T` es del propio bash y `>>` evita el pipe.
log() {
  local ts
  printf -v ts '%(%F %T)T' -1
  printf '[%s] %s\n' "$ts" "$*" >>"$LOG"
  printf '[%s] %s\n' "$ts" "$*"
}
libre_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }
# Sin `awk`: `borrar` lo llama una vez por candidato y cada proceso costaba ~4,7 ms (medido: 14 s
# de los 15 s de la pasada de /tmp, que es la que más candidatos tiene). Trunca en vez de redondear,
# lo que en una línea de log no cambia nada.
gb() {
  local b=${1:-0}
  printf '%d.%02d' $((b / 1073741824)) $((b % 1073741824 * 100 / 1073741824))
}
# Para lo que viene de docker, que cuenta en SI: así el número del log y el techo hablan en la
# misma unidad (si no, "12.25 GB (techo 12 GB)" parece un error cuando no lo es).
gbsi() { awk -v b="${1:-0}" 'BEGIN { printf "%.2f", b / 1000000000 }'; }
# Tamaños por candidato. Un `du` por candidato cuesta ~7 ms y en /tmp son ~2700 (~19 s), así que
# donde hay muchos candidatos se miden de una sola pasada (`marcar_tamanos`); el resto de rutas
# —totales de un objetivo, `debug/incremental`— se miden de verdad, que es una llamada y no mil.
declare -A TAM=()
bytes_de() {
  local r=${1%/}
  if [[ -n "${TAM[$r]:-}" ]]; then printf '%s\n' "${TAM[$r]}"; return 0; fi
  du -sb "$1" 2>/dev/null | cut -f1
}
# $1 = raíz; el resto, nombres de hijos que no se miden (los que tienen objetivo propio).
marcar_tamanos() {
  local r=${1%/} x p s t
  shift
  TAM=()
  [[ -d "$r" ]] || return 0
  while IFS=$'\t' read -r t p; do
    p=${p%/}
    [[ "$p" == "$r" ]] && continue
    TAM["$p"]=$t
  done < <(
    for x in "$r"/*; do
      [[ -e "$x" || -L "$x" ]] || continue
      p=${x##*/}
      for s in "$@"; do [[ "$p" == "$s" ]] && continue 2; done
      printf '%s\0' "$x"
    done | du -sb --files0-from=- 2>/dev/null
  )
}
ultima() { find "$1" -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1; }

# --- Protecciones precalculadas ----------------------------------------------
# Comprobar candidato a candidato costaba tres procesos por cada uno (75 s en la pasada de /tmp,
# con ~2700 elementos). Los tres conjuntos se calculan de una vez por objetivo y la comprobación
# queda en una búsqueda en memoria.
declare -A EN_USO=() CON_DATOS=() TIENE_GIT=()
MAPA_OK=0
MAPA_TS=0
GIT_OK=1
MAPA=$(mktemp -t cm-sweep-mapa.XXXXXX)
trap 'rm -f "$MAPA"' EXIT
# Cada cuánto se relee /proc mientras se borra sin umbrales. Una corrida dura minutos y lo que
# arranca en medio —un build cruzado que no pasa por cm-heavy— no está en el mapa del principio.
REFRESCO_S=${CM_SWEEP_REFRESCO_S:-5}

# --- En uso (D1) -------------------------------------------------------------
# El mapa se construye al empezar y se refresca antes de cada pasada sin umbrales y, si la pasada
# se alarga, cada REFRESCO_S segundos. Solo con las raíces que limpiamos: son unas decenas de
# líneas en vez de decenas de miles. El mapa solo crece: una ruta vista una vez sigue protegida
# (protección de más, nunca de menos).
construir_mapa_en_uso() {
  # `%l` da el destino del enlace: un find en vez de miles de readlink (uno por descriptor).
  { find /proc/[0-9]*/cwd /proc/[0-9]*/exe -maxdepth 0 -printf '%l\n' 2>/dev/null
    find /proc/[0-9]*/fd -mindepth 1 -maxdepth 1 -printf '%l\n' 2>/dev/null
  } | sed 's/ (deleted)$//' \
    | grep -E "^(${VTMP}|${TMPD}|${CASA})(/|$)" | sort -u > "$MAPA"
  # Sin mapa no se borra nada (fail-closed), pero hay que decirlo: un mapa vacío es un fallo, no
  # un disco limpio. Siempre tiene al menos el temporal de esta propia corrida.
  if [[ -s "$MAPA" ]]; then
    MAPA_OK=1
    MAPA_TS=$(date +%s)
    while IFS= read -r p; do
      while [[ "$p" == */* ]]; do EN_USO["$p"]=1; p=${p%/*}; done
    done < "$MAPA"
  elif (( MAPA_OK )); then
    # Un refresco vacío no tira lo ya sabido: se conserva el mapa anterior y se sigue.
    log "aviso: refresco del mapa vacío; se conserva el anterior"
  else
    log "aviso: mapa de procesos vacío; no se borrará nada en esta corrida"
  fi
}

# Se llama antes de cada borrado sin umbrales (AMPLIO). Fuera de ahí el umbral de antigüedad ya
# protege lo recién tocado y no se paga el escaneo.
refrescar_mapa_si_toca() {
  (( AMPLIO )) || return 0
  (( $(date +%s) - MAPA_TS >= REFRESCO_S )) && construir_mapa_en_uso
  return 0
}

# ¿Algo (cwd, ejecutable o fichero abierto) apunta a $1 o dentro de $1? Fail-closed: sin mapa, sí.
# El conjunto son las rutas usadas y todos sus ancestros: si una ruta usada está dentro del
# candidato, el candidato es uno de sus ancestros.
en_uso_por_proceso() {
  (( MAPA_OK )) || return 0
  [[ -n "${EN_USO[${1%/}]:-}" ]]
}

# --- Protecciones (D3) -------------------------------------------------------
es_nunca() {
  local r=${1%/} n
  for n in $NUNCA; do [[ "$r" == "$n" || "$r" == "$n"/* ]] && return 0; done
  return 1
}
# Datos que nunca se borran: si un directorio contiene alguno, no se toca el directorio entero.
# Los archivos comprimidos solo protegen en /var/tmp, donde el taller deja artefactos que sí valen
# (el dump de la BD, el tarball de una toolchain). En /tmp y en las cachés un .tar.gz es parte de
# la caché —el de vscode-test-cssvar blindaba 1,2 GB de basura— y por eso ahí no protege.
PATRON_DATOS=( -name '*.dump' -o -name '*.sql' -o -name '*.sqlite' -o -name '*.sqlite3' )
PATRON_ARCHIVOS=( -name '*.tar' -o -name '*.tar.*' -o -name '*.tgz' -o -name '*.gz' -o -name '*.xz' -o -name '*.zst' )
CONJUNTO_DATOS=datos
patron_datos() {
  PATRON_ACTUAL=("${PATRON_DATOS[@]}")
  [[ "$CONJUNTO_DATOS" == archivos ]] && PATRON_ACTUAL+=("${PATRON_ARCHIVOS[@]}")
}
datos_de() {
  patron_datos
  find "$1" -xdev \( "${PATRON_ACTUAL[@]}" \) -printf '%f ' 2>/dev/null | cut -c1-100
}
# Recalcula, para la raíz de un objetivo, qué candidatos contienen datos y cuáles tienen un
# checkout sucio. Se marca el directorio del hallazgo y toda su cadena de ancestros hasta la raíz,
# que es justo la condición que prueba `borrar` (el candidato contiene el hallazgo).
# Hasta 5 niveles: un volcado se deja en el scratch, no enterrado en un árbol de fuentes; así un
# `.sql` de migraciones dentro de un checkout no blinda el checkout entero.
marcar_protecciones() {
  local r=${1%/} p g
  CON_DATOS=(); TIENE_GIT=()
  CONJUNTO_DATOS=${2:-datos}
  patron_datos
  while IFS= read -r p; do
    while [[ "$p" == */* ]]; do
      CON_DATOS["$p"]=1
      [[ "$p" == "$r" ]] && break
      p=${p%/*}
    done
  done < <(find "$r" -xdev -maxdepth 5 \( "${PATRON_ACTUAL[@]}" \) -printf '%h\n' 2>/dev/null)
  if command -v git >/dev/null 2>&1; then
    while IFS= read -r g; do
      [[ -n "$(git -C "${g%/.git}" status --porcelain 2>/dev/null)" ]] || continue
      p=$g
      while [[ "$p" == */* ]]; do
        TIENE_GIT["$p"]=1
        [[ "$p" == "$r" ]] && break
        p=${p%/*}
      done
    done < <(find "$r" -xdev -maxdepth 4 -name .git -print 2>/dev/null)
  else
    # Sin git no se puede comprobar si hay trabajo sin commitear: no se borra nada en esta corrida.
    log "aviso: no hay git; no se borrará nada por precaución"
    GIT_OK=0
  fi
}

# Único punto de borrado: todo pasa por las protecciones, así que ninguna regla puede saltárselas.
# $1 = ruta, $2 = motivo (para el log y para el --dry-run).
borrar() {
  local r=${1%/} motivo=${2:-} antes
  [[ -e "$r" || -L "$r" ]] || return 0
  (( GIT_OK )) || return 1
  es_nunca "$r" && { log "no se toca $r: ruta protegida"; return 1; }
  refrescar_mapa_si_toca # sin umbrales, el mapa del principio puede ser de hace minutos
  en_uso_por_proceso "$r" && { log "no se toca $r: lo usa un proceso"; return 1; }
  [[ -n "${CON_DATOS[$r]:-}" ]] && { log "no se toca $r: contiene datos ($(datos_de "$r"))"; return 1; }
  [[ -n "${TIENE_GIT[$r]:-}" ]] && { log "no se toca $r: git con cambios sin commitear"; return 1; }
  # Del mapa si está (una sustitución de comandos es un fork, y aquí se llama miles de veces).
  antes=${TAM[$r]:-}
  [[ -n "$antes" ]] || antes=$(bytes_de "$r")
  antes=${antes:-0}
  (( DRY )) || rm -rf -- "$r"
  BORRADOS=$((BORRADOS + 1))
  LIBERADO=$((LIBERADO + antes))
  (( DRY )) && log "dry-run: borraría $r ($(gb "$antes") GB) — $motivo"
  return 0
}
resumen() { # $1 nombre, $2 BORRADOS de partida, $3 LIBERADO de partida
  local n=$((BORRADOS - $2)) b=$((LIBERADO - $3))
  (( n > 0 )) && log "$1: $n elementos, $(gb "$b") GB"
  return 0
}

# --- Niveles y umbrales (D4) -------------------------------------------------
NIVEL=0
H_TARGET=$UMBRAL_H; H_VTMP=24; H_TMP=24; H_CASA=168; H_CARO=168
fijar_umbrales() {
  case $NIVEL in
    0) H_TARGET=$UMBRAL_H; H_VTMP=24;  H_TMP=24; H_CASA=168; H_CARO=168 ;;
    1) H_TARGET=12;        H_VTMP=2;   H_TMP=2;  H_CASA=24;  H_CARO=48 ;;
    2) H_TARGET=0;         H_VTMP=0;   H_TMP=0;  H_CASA=0;   H_CARO=0 ;;
  esac
}
# ¿Nada dentro de $1 se tocó en las últimas $2 horas? Con 0 horas todo es candidato (nivel 2).
# El mapa se construye de una vez por raíz (`marcar_recientes`) en vez de un find por candidato
# (~8 ms cada uno, ~22 s en la pasada de /tmp).
declare -A RECIENTES=()
RECIENTES_RAIZ=
RECIENTES_H=-1
marcar_recientes() { # $1 = raíz, $2 = horas
  local r=${1%/} h=${2:-0} p
  RECIENTES=(); RECIENTES_RAIZ=$r; RECIENTES_H=$h
  (( h > 0 )) || return 0
  # Cada ruta reciente se colapsa a su hijo directo de la raíz, que es el único nivel que se borra.
  while IFS= read -r p; do RECIENTES["$p"]=1; done < <(
    find "$r" -xdev -mmin "-$((h * 60))" -printf '%p\n' 2>/dev/null |
      sed -n "s|^$r/\([^/]*\).*|$r/\1|p"
  )
}
# Comprobación directa, con un find propio.
antiguo_find() {
  local r=$1 h=$2
  (( h <= 0 )) && return 0
  ! find "$r" -xdev -mmin "-$((h * 60))" -print -quit 2>/dev/null | grep -q .
}
# El mapa solo vale para hijos directos de la raíz con la que se construyó y con el mismo umbral.
# Para cualquier otra ruta (o con otro umbral) se comprueba a mano: una consulta a ciegas daría un
# «no reciente» falso y borraría algo que se acaba de usar.
antiguo() {
  local r=${1%/} h=${2:-0} rel
  (( h <= 0 )) && return 0
  rel=${r#"$RECIENTES_RAIZ"/}
  if (( h != RECIENTES_H )) || [[ "$rel" == "$r" || "$rel" == */* ]]; then
    antiguo_find "$r" "$h"; return $?
  fi
  [[ -z "${RECIENTES[$r]:-}" ]]
}

# --- Objetivo 1: targets de compilación del taller ---------------------------
# `debug/incremental` tiene dos niveles que se acumulan y ninguno se limpia solo:
#   incremental/<crate>-<hash>/<sesión>/…
# - Nivel 1: un `<crate>-<hash>` por cada hash de parámetros de compilación (el hash cambia, entre
#   otras cosas, según RUSTC_WRAPPER esté puesto o no). Medido el 2026-10-17: 52 directorios en
#   KAMPLES, 7,9 GB; 22 en MN, 1,36 GB.
# - Nivel 2: una carpeta de sesión por compilación dentro de cada uno.
# Se conservan los 2 más recientes de cada nivel: basta para no perder ninguna de las dos
# configuraciones que se alternan. Bajo el lock de cm-heavy, así que nunca pisa un build en marcha.
podar_incremental() {
  local t inc c p n d antes desp total=0 configs=0 sesiones=0
  # Aquí se borra sin pasar por `borrar` (son directorios de sesión dentro de un target vivo, que
  # el propio predicado protegería por estar en uso): en dry-run no se toca nada.
  if (( DRY )); then
    log "dry-run: se podarían las sesiones y configuraciones viejas de debug/incremental"
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
      sesiones=$((sesiones + n - 2))
    done
    for p in $(for c in "$inc"/*/; do c=${c%/}; echo "${c##*/}"; done | sed 's/-[^-]*$//' | sort -u); do
      n=$(ls -1d "$inc/$p-"* 2>/dev/null | wc -l)
      (( n <= 2 )) && continue
      while read -r d; do rm -rf -- "$d"; done < <(ls -1dt "$inc/$p-"* 2>/dev/null | tail -n +3)
      configs=$((configs + n - 2))
    done
    desp=$(bytes_de "$inc"); desp=${desp:-0}
    d=$((antes - desp))
    if (( d > 0 )); then
      total=$((total + d))
      log "incremental: ${t##*/} $(gb "$antes") -> $(gb "$desp") GB"
    fi
  done
  (( configs + sesiones > 0 )) && log "incremental: $configs configuraciones y $sesiones sesiones podadas, $(gb "$total") GB"
  return 0
}

limpiar_targets() {
  local techo=$(( $1 * 1073741824 )) t total n0=$BORRADOS b0=$LIBERADO
  [[ -d "$RAIZ" ]] || return 0
  [[ "${RAIZ##*/}" == "$HOJA_TARGET" ]] \
    || { log "targets: hoja inesperada en $RAIZ (se esperaba $HOJA_TARGET), omitido"; return 0; }
  marcar_protecciones "$RAIZ" archivos
  exec 8>>"$LOCK"
  if (( NIVEL == 2 )); then
    flock -w "$ESPERA_LOCK_S" 8 || { log "targets: omitidos, cm-heavy tiene el lock tras ${ESPERA_LOCK_S} s"; exec 8>&-; return 0; }
  else
    flock -n 8 || { log "targets: omitidos, cm-heavy tiene el lock (build en marcha); el resto de la limpieza sigue"; exec 8>&-; return 0; }
  fi
  for t in "$RAIZ"/*/; do
    t=${t%/}; [[ -d "$t" ]] || continue
    (( H_TARGET > 0 )) && ! antiguo "$t" "$H_TARGET" && continue
    borrar "$t" "target sin uso desde ${H_TARGET} h"
  done
  podar_incremental
  # Techo: si aún pasa de TECHO_GB, se quitan los más antiguos (nunca los protegidos).
  total=$(bytes_de "$RAIZ"); total=${total:-0}
  if (( total > techo )); then
    while read -r _ t; do
      total=$(bytes_de "$RAIZ"); total=${total:-0}
      (( total <= techo )) && break
      borrar "$t" "techo ${TECHO_GB} GB"
    done < <(for t in "$RAIZ"/*/; do t=${t%/}; u=$(ultima "$t"); printf '%s %s\n' "${u:-0}" "$t"; done | sort -n)
  fi
  flock -u 8; exec 8>&-
  resumen "targets" "$n0" "$b0"
}

# --- Objetivo 2: artefactos de calidad por commit ----------------------------
# /var/tmp/glory-quality/<herramienta>/<commit>: se conserva el commit más reciente de cada
# herramienta (es el que reutiliza el gate) y se poda el resto.
limpiar_calidad() {
  local h c n0=$BORRADOS b0=$LIBERADO
  [[ -d "$CALIDAD" ]] || return 0
  [[ "${CALIDAD##*/}" == "$HOJA_CALIDAD" ]] \
    || { log "calidad: hoja inesperada en $CALIDAD (se esperaba $HOJA_CALIDAD), omitido"; return 0; }
  marcar_protecciones "$CALIDAD" archivos
  for h in "$CALIDAD"/*/; do
    h=${h%/}; [[ -d "$h" ]] || continue
    while read -r c; do
      [[ -n "$c" ]] && borrar "$c" "commit antiguo de ${h##*/}"
    done < <(ls -1dt "$h"/*/ 2>/dev/null | tail -n +$((CALIDAD_POR_HERRAMIENTA + 1)))
  done
  resumen "calidad" "$n0" "$b0"
}

# --- Objetivo 3: resto de /var/tmp -------------------------------------------
# Scratch de ejecuciones puntuales (checkouts, fmt, análisis). glory-target y glory-quality tienen
# su objetivo propio; los "caros" (targets de compilación cruzada) aguantan más: rehacerlos cuesta
# una descarga de toolchain.
limpiar_vtmp() {
  local x b h n0=$BORRADOS b0=$LIBERADO
  [[ -d "$VTMP" ]] || return 0
  [[ "${VTMP##*/}" == "tmp" ]] || { log "/var/tmp: hoja inesperada en $VTMP, omitido"; return 0; }
  marcar_protecciones "$VTMP" archivos
  marcar_tamanos "$VTMP" glory-target glory-quality
  marcar_recientes "$VTMP" "$H_VTMP"
  for x in "$VTMP"/*; do
    [[ -e "$x" || -L "$x" ]] || continue
    b=${x##*/}
    case "$b" in glory-target|glory-quality) continue ;; esac
    # Ni los temporales privados de systemd (los usa un servicio vivo), ni cloud-init, ni lo
    # nuestro. Los ocultos son sockets y locks, como en /tmp.
    case "$b" in .*|systemd-private-*|snap-private-tmp|cloud-init|cm-heavy*|cm-sweep*) continue ;; esac
    # El único con umbral propio: `antiguo` ya lo detecta y se comprueba a mano.
    case "$b" in coolify-manager-rs) h=$H_CARO ;; *) h=$H_VTMP ;; esac
    antiguo "$x" "$h" || continue
    borrar "$x" "scratch de /var/tmp sin uso desde ${h} h"
  done
  resumen "/var/tmp ajeno" "$n0" "$b0"
}

# --- Objetivo 4: /tmp --------------------------------------------------------
# Niveles 0 y 1: solo las familias conocidas (medidas el 2026-10-19), que es la lista cerrada.
# Nivel 2: todo lo que no esté excluido ni protegido. Excluidos siempre los sockets y locks de X,
# tmux, los directorios privados de systemd y nuestro propio temporal.
limpiar_tmp() {
  local x b n0=$BORRADOS b0=$LIBERADO
  [[ -d "$TMPD" ]] || return 0
  [[ "${TMPD##*/}" == "tmp" ]] || { log "/tmp: hoja inesperada en $TMPD, omitido"; return 0; }
  marcar_protecciones "$TMPD" datos
  marcar_tamanos "$TMPD"
  marcar_recientes "$TMPD" "$H_TMP"
  for x in "$TMPD"/*; do
    [[ -e "$x" || -L "$x" ]] || continue
    b=${x##*/}
    case "$b" in .*|tmux-*|systemd-private-*|snap-private-tmp|cm-heavy.lock|cm-sweep-*) continue ;; esac
    if (( AMPLIO == 0 )); then
      case "$b" in
        wm-*|vs-*|sentinel-*|almacen-persistido-*|vscode-test-cssvar|gs-core*.log|*-t.log) ;;
        *) continue ;;
      esac
    fi
    antiguo "$x" "$H_TMP" || continue
    borrar "$x" "resto de /tmp sin uso desde ${H_TMP} h"
  done
  resumen "/tmp" "$n0" "$b0"
}

# --- Objetivo 5: cachés de casa ----------------------------------------------
# /home/usuario/.cache/* y la caché de npm: regenerables, pero caras (cargo-xwin, mn-target,
# cargo-restaurante), de ahí los 7 días en mantenimiento. Nunca ~/.cargo/registry (está en $NUNCA)
# ni la caché de opencode, que es de una herramienta viva.
limpiar_casa() {
  local x b n0=$BORRADOS b0=$LIBERADO
  marcar_protecciones "$CASA/.cache" datos
  marcar_recientes "$CASA/.cache" "$H_CASA"
  for x in "$CASA/.cache"/*; do
    [[ -e "$x" ]] || continue
    b=${x##*/}
    [[ "$b" == opencode ]] && continue
    antiguo "$x" "$H_CASA" || continue
    borrar "$x" "caché de casa sin uso desde ${H_CASA} h"
  done
  if [[ -d "$CASA/.npm/_cacache" ]]; then
    marcar_protecciones "$CASA/.npm/_cacache" datos
    antiguo "$CASA/.npm/_cacache" "$H_CASA" && borrar "$CASA/.npm/_cacache" "caché de npm sin uso desde ${H_CASA} h"
  fi
  resumen "cachés de casa" "$n0" "$b0"
}

# --- Objetivo 6: docker ------------------------------------------------------
# Bytes que ocupa hoy la caché de BuildKit (0 si docker no responde).
cache_buildx() {
  local s
  s=$(docker system df --format '{{json .}}' 2>/dev/null \
        | grep '"Type":"Build Cache"' | grep -o '"Size":"[^"]*"' | cut -d'"' -f4)
  a_bytes "${s:-0B}"
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

podar_docker() {
  local techo=$1 img antes desp n0=$BORRADOS b0=$LIBERADO
  docker info >/dev/null 2>&1 || { log "docker: no responde, omitido"; return 0; }
  if (( DRY )); then
    log "dry-run: caché de build $(gbsi "$(cache_buildx)") GB; se podaría a ${techo} GB y se retirarían las imágenes cm-local/* sobrantes"
    return 0
  fi
  antes=$(cache_buildx)
  # Sin `--filter`: el techo es un presupuesto y BuildKit elige por LRU. Con filtro de antigüedad
  # solo poda los candidatos que pasan el filtro y puede rendirse antes del techo devolviendo 0.
  docker buildx prune -f --max-used-space "${techo}GB" >/dev/null 2>&1
  desp=$(cache_buildx)
  log "docker: caché de build $(gbsi "$antes") -> $(gbsi "$desp") GB (techo $techo GB, poda LRU)"
  # BuildKit siempre deja un residuo que no puede desalojar (medido: 2 % sobre el techo), así que
  # solo se avisa si se pasa de verdad; un aviso que salta cada cuarto de hora no avisa de nada.
  (( desp > techo * 1000000000 * 115 / 100 )) && log "docker: aviso, la caché sigue por encima del techo tras la poda"
  LIBERADO=$((LIBERADO + antes - desp))
  docker image prune -f >/dev/null 2>&1
  docker images --filter 'reference=cm-local/*' --format '{{.Repository}}{{"\t"}}{{.Tag}}{{"\t"}}{{.CreatedAt}}' \
    | sort -t$'\t' -k1,1 -k3,3r \
    | awk -F'\t' -v n="$IMG_POR_SITIO" '{ c[$1]++; if (c[$1] > n) print $1 ":" $2 }' \
    | while read -r img; do
        docker rmi "$img" >/dev/null 2>&1 && log "docker: imagen $img retirada (más de $IMG_POR_SITIO por sitio)"
      done
  resumen "docker" "$n0" "$b0"
}

# --- Corrida ----------------------------------------------------------------
libre_inicio=$(libre_gb)
(( libre_inicio < OBJETIVO_GB )) && NIVEL=1
(( libre_inicio < SUELO_GB )) && NIVEL=2
fijar_umbrales
(( NIVEL == 2 )) && AMPLIO=1
(( DRY )) && log "dry-run: no se borra nada; nivel calculado $NIVEL con $libre_inicio GB libres"
log "inicio: nivel $NIVEL, $libre_inicio GB libres (objetivo $OBJETIVO_GB GB, suelo $SUELO_GB GB)"
construir_mapa_en_uso

# 1. Limpieza normal, cada objetivo con su umbral de nivel.
limpiar_targets "$TECHO_GB"
limpiar_calidad
limpiar_vtmp
limpiar_tmp
limpiar_casa
podar_docker "$BUILDX_GB"

# 2. Si no se llega al objetivo, se repite la basura sin umbrales (los targets no: ya tienen techo).
#    Así una corrida sola alcanza el objetivo en vez de esperar a la siguiente.
if (( ! DRY )) && (( NIVEL < 2 )) && (( $(libre_gb) < OBJETIVO_GB )); then
  log "objetivo: $(libre_gb) GB < $OBJETIVO_GB GB; segunda pasada sin umbrales"
  H_VTMP=0; H_TMP=0; H_CASA=0; AMPLIO=1
  # Sin umbrales, todo candidato vale: se relee /proc aquí, que es cuando el mapa ya puede ser viejo.
  construir_mapa_en_uso
  limpiar_vtmp
  limpiar_tmp
  limpiar_casa
  podar_docker "$BUILDX_GB"
fi

# 3. Sistema: journal y paquetes.
if (( ! DRY )); then
  (( NIVEL == 2 )) && JOURNAL_MB=100
  journalctl --vacuum-size="${JOURNAL_MB}M" >/dev/null 2>&1
  apt-get clean >/dev/null 2>&1
fi

# 4. Suelo duro: si aun así no llega, poda agresiva de targets y caché de build entera.
libre=$(libre_gb)
if (( ! DRY )) && (( libre < SUELO_GB )); then
  log "suelo: $libre GB libres < $SUELO_GB GB; poda agresiva"
  H_TARGET=0
  # Es el borrado más destructivo de la corrida y llega al final: el mapa se relee justo antes.
  construir_mapa_en_uso
  limpiar_targets 0
  antes=$(cache_buildx)
  docker buildx prune -af >/dev/null 2>&1
  log "docker: caché de build $(gbsi "$antes") -> $(gbsi "$(cache_buildx)") GB (vaciada por suelo)"
  libre=$(libre_gb)
fi

if (( libre < SUELO_GB )); then estado=BLOQUEADO; else estado=OK; fi
if (( DRY )); then
  log "dry-run: liberaría $(gb "$LIBERADO") GB en $BORRADOS elementos; nivel $NIVEL"
else
  install -d -m 755 "${ESTADO%/*}"
  # El epoch va en la misma posición que antes por si alguien lo parsea; lo nuevo se añade detrás.
  echo "$estado libre=${libre}GB $(date +%s) nivel=$NIVEL liberadoGb=$(gb "$LIBERADO") borrados=$BORRADOS" > "$ESTADO"
fi
log "estado=$estado nivel=$NIVEL libre=${libre} GB (objetivo ${OBJETIVO_GB} GB, suelo ${SUELO_GB} GB, techo targets ${TECHO_GB} GB, umbral ${UMBRAL_H} h, liberado $(gb "$LIBERADO") GB en $BORRADOS elementos)"
