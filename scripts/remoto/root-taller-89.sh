#!/usr/bin/env bash
# Lote root de la VPS 89 (plan taller remoto: F8 WireGuard y F5 Docker).
# Lo ejecuta la usuaria a mano, con su contraseña de sudo; el agente no la conoce:
#   sudo bash ~/taller/workspace-manager/scripts/remoto/root-taller-89.sh
# Con el peer del laptop, delante de sudo: PEER_PUB=<clave pública del laptop> (y opcional PEER_IP, WG_IP_SERVIDOR).
# [por que] Idempotente y sin destrucción: no borra imágenes, volúmenes ni claves existentes;
# no activa ufw (si está inactivo, avisa y no añade reglas) y no cierra el 22 público (eso es F8, después).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Usuario del taller dueño de ~/taller. No va incrustado: se deduce de quien
# invoca sudo, que es justo quien tiene el directorio. OPERADOR lo pisa.
OPERADOR="${OPERADOR:-${SUDO_USER:-dev}}"
DIR_WG=/etc/wireguard
IFAZ=wg0
PUERTO_WG=51820
IP_SERVIDOR="${WG_IP_SERVIDOR:-192.0.2.1/24}"
IP_PEER="${PEER_IP:-192.0.2.2}"
LOG=/home/$OPERADOR/taller/_logs/root-taller-89.log

[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1
echo "== $(date -Is) lote root"

# 1. WireGuard: herramientas y claves del servidor (la privada no sale de la 89).
apt-get update -qq
apt-get install -y -qq wireguard-tools
install -d -m 0700 "$DIR_WG"
if [ ! -f "$DIR_WG/$IFAZ.key" ]; then
  umask 077
  wg genkey > "$DIR_WG/$IFAZ.key"
  wg pubkey < "$DIR_WG/$IFAZ.key" > "$DIR_WG/$IFAZ.pub"
  echo "claves creadas en $DIR_WG"
fi

# 2. Configuración de wg0: se crea una vez; después solo se añade el peer si falta.
if [ ! -f "$DIR_WG/$IFAZ.conf" ]; then
  umask 077
  printf '[Interface]\nAddress = %s\nListenPort = %s\nPrivateKey = %s\n' \
    "$IP_SERVIDOR" "$PUERTO_WG" "$(cat "$DIR_WG/$IFAZ.key")" > "$DIR_WG/$IFAZ.conf"
  echo "wg0.conf creado (sin peers)"
fi
CAMBIO=0
if [ -n "${PEER_PUB:-}" ] && ! grep -q "PublicKey = $PEER_PUB" "$DIR_WG/$IFAZ.conf"; then
  printf '\n[Peer]\nPublicKey = %s\nAllowedIPs = %s/32\n' "$PEER_PUB" "$IP_PEER" >> "$DIR_WG/$IFAZ.conf"
  CAMBIO=1
  echo "peer añadido: $IP_PEER/32"
fi
chmod 600 "$DIR_WG/$IFAZ.conf"

# 3. Cortafuegos: solo reglas; no se activa ufw.
if ufw status | grep -q '^Status: active'; then
  ufw allow in on "$IFAZ" comment 'WireGuard taller (F8)'
  ufw allow "$PUERTO_WG"/udp comment 'WireGuard taller (F8)'
else
  echo "AVISO: ufw inactivo; no se añaden reglas. Revisar antes de activarlo."
fi

# 4. Servicio: arranque al boot; si ya corre y cambió el peer, se sincroniza sin cortar.
systemctl enable "wg-quick@$IFAZ" >/dev/null
if systemctl is-active --quiet "wg-quick@$IFAZ"; then
  if [ "$CAMBIO" -eq 1 ]; then
    wg syncconf "$IFAZ" <(wg-quick strip "$IFAZ")
  fi
else
  systemctl start "wg-quick@$IFAZ"
fi

# 5. Docker: solo lectura (F5). No se hace prune ni se borra nada.
docker system df -v > "/home/$OPERADOR/taller/_logs/f5-docker-df-$(date +%F).txt"
echo "docker system df guardado en _logs/f5-docker-df-$(date +%F).txt"

echo "-- wg show (sin claves privadas)"; wg show "$IFAZ" | grep -v 'private key' || true
echo "-- ufw"; ufw status numbered | head -n 20 || true
echo "== fin"
