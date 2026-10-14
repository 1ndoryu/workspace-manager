#!/usr/bin/env bash
# provision-89.sh: reconstruye el taller remoto (VPS 89, Ubuntu 24.04) en una VPS vacía.
# Plan: Agente/planes/plan-taller-remoto-vps89-2026-10-14.md (F0, F1 y reglas de F8).
# Idempotente: relanzarlo no cambia lo ya correcto. Sin secretos: la clave pública se pasa por ruta.
# Ejecutar como root y solo con autorización por lote (AGENTS §9.1). No crea el disco de respaldo
# ni los slices de systemd: eso lo decide la medición de F1.
#
# Uso:
#   provision-89.sh --clave-publica /ruta/id_ed25519.pub [--sin-coolify-stop]
set -euo pipefail

CLAVE_PUB=""
PARAR_COOLIFY=1
while (($#)); do
  case "$1" in
    --clave-publica) CLAVE_PUB="${2:?falta la ruta de la clave pública}"; shift 2 ;;
    --sin-coolify-stop) PARAR_COOLIFY=0; shift ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "provision-89: requiere root" >&2
  exit 1
fi

log() { printf '[provision] %s\n' "$*"; }

# 1. Paquetes del sistema (apt es idempotente). unzip lo exige el instalador de fnm (paso 10).
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git tmux curl ca-certificates unzip build-essential pkg-config libssl-dev \
  clang lld ufw fail2ban unattended-upgrades postgresql postgresql-16-pgvector
log "paquetes del sistema instalados"

# 2. Usuario dev: sin sudo, sin docker, contraseña bloqueada, login solo por clave.
if ! id dev &>/dev/null; then
  useradd -m -s /bin/bash dev
  log "usuario dev creado"
fi
usermod -p '*' dev
for grupo in sudo docker adm lxd; do
  if id -nG dev | tr ' ' '\n' | grep -qx "$grupo"; then
    gpasswd -d dev "$grupo" >/dev/null
    log "dev quitado del grupo $grupo"
  fi
done

install -d -m 700 -o dev -g dev /home/usuario/.ssh
if [[ -n "$CLAVE_PUB" ]]; then
  [[ -f "$CLAVE_PUB" ]] || { echo "provision-89: no existe $CLAVE_PUB" >&2; exit 1; }
  CLAVE=$(head -n 1 "$CLAVE_PUB")
  AUT=/home/usuario/.ssh/authorized_keys
  touch "$AUT"
  grep -qxF "$CLAVE" "$AUT" || printf '%s\n' "$CLAVE" >> "$AUT"
  chown dev:dev "$AUT"
  chmod 600 "$AUT"
  log "clave pública de dev instalada"
fi

# 3. sshd: sin contraseña (drop-in propio; se valida antes de recargar).
cat > /etc/ssh/sshd_config.d/10-taller.conf <<'EOF'
# Gestionado por provision-89.sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh
log "sshd: solo clave"

# 4. Red: ufw con entrada denegada salvo 22 (F8 retira el 22 público tras probar la red privada).
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'ssh; publico hasta F8' >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null
log "ufw activo (entrada denegada, 22 permitido) y fail2ban activo"

# 5. Actualizaciones de seguridad automáticas.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades >/dev/null
log "unattended-upgrades activo"

# 6. Swap de 4 GiB si no hay ninguna (la 89 ya la tenía creada).
if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "swap de 4 GiB creada"
fi

# 7. Coolify: se detiene y no se borra; no se reinicia con el sistema.
if ((PARAR_COOLIFY)) && command -v docker >/dev/null; then
  for contenedor in coolify coolify-proxy coolify-sentinel coolify-redis coolify-db; do
    if docker ps -q --filter "name=^${contenedor}$" | grep -q .; then
      docker stop "$contenedor" >/dev/null
      log "parado $contenedor (no borrado)"
    fi
    if docker ps -aq --filter "name=^${contenedor}$" | grep -q .; then
      docker update --restart=no "$contenedor" >/dev/null
    fi
  done
fi

# 8. PostgreSQL para tests: solo socket local (peer), sin contraseña, rol dev sin superusuario.
systemctl enable --now postgresql >/dev/null
EXISTE_ROL=$(runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='dev'")
if [[ "$EXISTE_ROL" != 1 ]]; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qc "CREATE ROLE dev LOGIN CREATEDB"
  log "rol de PostgreSQL dev creado"
fi

# 9. Cola de compilación: un build pesado a la vez, con techo de memoria y preflight.
install -d -m 755 -o dev -g dev /var/cache/sccache /var/tmp/glory-target
cat > /usr/local/bin/cm-heavy <<'EOF'
#!/usr/bin/env bash
# Builds pesados de a uno (flock), con techo de memoria y preflight (plan F1, Presupuesto de RAM).
# MemoryMax=4G es provisional mientras haya agentes residentes. Sale con 75 si no puede ejecutar
# (memoria o disco): el build no arranca y el mensaje dice qué falta. cm-sweep limpia antes (F5).
set -euo pipefail
ESPERA="${CM_HEAVY_ESPERA:-600}"
MEM_MAX="${CM_HEAVY_MEM_MAX:-4G}"
MIN_MB="${CM_HEAVY_MIN_MB:-4096}"
MIN_DISCO_GB="${CM_HEAVY_MIN_DISK_GB:-15}"
(($#)) || { echo "uso: cm-heavy <comando...>" >&2; exit 2; }
exec 9>>/run/lock/cm-heavy.lock
flock -w "$ESPERA" 9 || { echo "cm-heavy: otro build ocupa el lock tras ${ESPERA} s" >&2; exit 75; }
DISPONIBLE_MB=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
if ((DISPONIBLE_MB < MIN_MB)); then
  echo "cm-heavy: ${DISPONIBLE_MB} MB libres (mínimo ${MIN_MB})" >&2
  exit 75
fi
LIBRE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if ((LIBRE_GB < MIN_DISCO_GB)); then
  echo "cm-heavy: ${LIBRE_GB} GB libres en / (mínimo ${MIN_DISCO_GB}); revisar /var/log/cm-sweep.log" >&2
  exit 75
fi
if [[ $EUID -eq 0 ]]; then SR=(systemd-run --scope); else SR=(systemd-run --user --scope); fi
exec "${SR[@]}" -p "MemoryMax=${MEM_MAX}" -- "$@"
EOF
chmod 755 /usr/local/bin/cm-heavy
cat > /usr/lib/tmpfiles.d/cm-heavy.conf <<'EOF'
f /run/lock/cm-heavy.lock 0666 root root -
EOF
systemd-tmpfiles --create /usr/lib/tmpfiles.d/cm-heavy.conf
log "cm-heavy instalado"

# 9b. Limpieza periódica (F5): cm-sweep.sh junto a este script es la única fuente; --instalar es idempotente.
SWEEP_SRC="$(dirname "$(readlink -f "$0")")/cm-sweep.sh"
[[ -f "$SWEEP_SRC" ]] || { echo "falta cm-sweep.sh junto a provision-89.sh" >&2; exit 1; }
bash "$SWEEP_SRC" --instalar
log "cm-sweep instalado (timer horario)"

# 10. Toolchain de dev (sin root): rustup, componentes, nextest y node LTS con fnm.
runuser -u dev -- bash -s <<'EOF'
set -euo pipefail
if [[ ! -x "$HOME/.cargo/bin/rustup" ]]; then
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
. "$HOME/.cargo/env"
rustup component add clippy rustfmt >/dev/null
if [[ ! -x "$HOME/.cargo/bin/cargo-nextest" ]]; then
  curl -LsSf https://get.nexte.st/latest/linux | tar zxf - -C "$HOME/.cargo/bin"
fi
if [[ ! -x "$HOME/.local/bin/fnm" ]]; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$HOME/.local/bin" --skip-shell
fi
export PATH="$HOME/.local/bin:$PATH"
fnm install --lts >/dev/null
echo "[provision] toolchain de dev: $(rustc --version), node $(fnm exec --using=lts-latest node --version)"
EOF

log "fin. Comprobar: ufw status, ss -ltn (solo 22 público), systemctl is-active postgresql fail2ban"
