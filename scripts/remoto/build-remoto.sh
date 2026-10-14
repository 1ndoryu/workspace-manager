#!/usr/bin/env bash
# Compila o prueba un repo Rust en la VPS en vez de en local.
# Solo compila código ya pusheado: árbol limpio y HEAD igual a origin/<rama>.
# Uso: bash scripts/remoto/build-remoto.sh <ruta-repo-local> <subcomando-cargo> [args...]
#   ej: bash scripts/remoto/build-remoto.sh "/c/Users/Owner/OneDrive/Documentos/area-trabajo/MN-Inmobiliaria" check --tests
#       bash scripts/remoto/build-remoto.sh "/c/Users/Owner/OneDrive/Documentos/area-trabajo/MN-Inmobiliaria" test --no-fail-fast
# Sale con el código de cargo; 3 si el repo no está listo para compilar remoto.
set -euo pipefail

VPS="${BUILD_VPS:-root@89.117.16.170}"
REPO_LOCAL="${1:?falta la ruta del repo local}"; shift
[ "$#" -gt 0 ] || { echo "build-remoto: falta el subcomando de cargo" >&2; exit 2; }

git -C "$REPO_LOCAL" rev-parse --is-inside-work-tree >/dev/null
# Un fallo de compilación remota solo significa algo si el código remoto es el local.
if [ -n "$(git -C "$REPO_LOCAL" status --porcelain)" ]; then
  echo "build-remoto: hay cambios sin commit en $REPO_LOCAL; haz commit y push primero" >&2
  exit 3
fi
git -C "$REPO_LOCAL" fetch -q origin
RAMA=$(git -C "$REPO_LOCAL" rev-parse --abbrev-ref HEAD)
if [ "$(git -C "$REPO_LOCAL" rev-parse HEAD)" != "$(git -C "$REPO_LOCAL" rev-parse "origin/$RAMA")" ]; then
  echo "build-remoto: HEAD no coincide con origin/$RAMA; haz push primero" >&2
  exit 3
fi
URL=$(git -C "$REPO_LOCAL" remote get-url origin)
NOMBRE=$(basename "$URL" .git)
DIR="/root/build/$NOMBRE"

# El clon de la VPS es desechable: se alinea siempre con origin. Usa sccache y 2 jobs para no saturar la VPS.
ssh -o BatchMode=yes "$VPS" bash -s -- "$URL" "$RAMA" "$DIR" "$@" <<'REMOTO'
set -euo pipefail
URL="$1"; RAMA="$2"; DIR="$3"; shift 3
. "$HOME/.cargo/env"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin
  git -C "$DIR" checkout -q "$RAMA"
  git -C "$DIR" reset -q --hard "origin/$RAMA"
else
  mkdir -p "$(dirname "$DIR")"
  git clone -q --branch "$RAMA" "$URL" "$DIR"
fi
cd "$DIR"
export RUSTC_WRAPPER=sccache CARGO_BUILD_JOBS=2
exec cargo "$@"
REMOTO
