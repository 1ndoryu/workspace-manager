# Plan Docker ligero en WSL2 sin Docker Desktop + refuerzo limpiador-pc (04AA-1)

Fecha: 2026-10-04. Estado: plan redactado, pendiente de 4 decisiones del usuario. Sin ejecutar nada.

## Objetivo

Sustituir Docker Desktop (3,29 GB app + 1,65 GB datos, medidos 2026-10-04) por el motor
Docker dentro de una distro WSL2 propia + cliente suelto en Windows, manteniendo la
compilacion en laptop del `01AA-3`, y extender `limpiador-pc` con fase `docker-*` que
borre automaticamente los restos muertos como refuerzo.

## Alcance / no alcance

- SI: recrear distro (la `Debian` actual esta rota: su `ext4.vhdx` no existe,
  `Wsl/Service/CreateInstance/MountDisk/HCS/ERROR_PATH_NOT_FOUND`), instalar
  `docker-ce`, exponerlo en loopback, cliente Windows, desinstalar Desktop por su
  desinstalador, fase `docker-scan`/`docker-clean` en `limpiador-pc` 0.7.0.
- NO: migrar los 13 productivos (siguen en modo `vps` por defecto, intactos),
  Kubernetes, TLS en loopback (ver D1), refactoring ajeno.

## Dependencias y datos de partida (verificados 2026-10-04)

- WSL: distros `docker-desktop` (Stopped) y `Debian` (Stopped, rota por vhdx ausente).
- Laptop `AMD64`: construir `linux/amd64` no necesita emulacion.
- `coolify-manager-rs` NO necesita cambios: `--docker-bin` (defecto `"docker"`, resuelto
  por PATH, `cli/mod.rs:188`) y usa `build` clasico (`build_laptop.rs:528`), mas
  `version`, `system df`, `images/rmi/save`, `podar_colgadas`, `rotar_etiquetas_laptop`.
  Sin `buildx`. Basta un `docker.exe` cliente en PATH + `DOCKER_HOST`.
- `C:\Users\Owner\bin` existe (vive `coolify-manager.exe`); verificar si esta en PATH,
  si no, añadirlo a nivel usuario.
- Debian rota implica instalar distro de cero: `wsl --install -d Debian` (tienda/internet)
  o `wsl --import` desde rootfs descargado si la tienda falla.

## Fases (cada una cierra con su verificacion, sin pasar a la siguiente en rojo)

- F0 Preflight y foto: `C-libre`, tamanos de las dos carpetas, `docker version` actual,
  `wsl --list --verbose`. Deja constancia del punto de partida.
- F1 Distro sana: `wsl --unregister Debian` (esta rota, sin datos que salvar) +
  instalacion fresca; verifica `wsl -d Debian -- echo OK` y `os-release`.
  Systemd via `/etc/wsl.conf` (`[boot] systemd=true`) + `wsl --shutdown` si disponible;
  si no, `service docker start`.
- F2 Motor en Debian: `docker-ce` del repo oficial; daemon SOLO en
  `tcp://127.0.0.1:2375` sin TLS (D1); `data-root` por defecto dentro de la distro (D2).
  Tarea programada al logon que levanta el servicio (`wsl -d Debian ... service docker
  start`, sudo sin clave limitado a eso) porque WSL no autoarranca tras reinicio (D4).
  Verifica dentro de Debian: `docker version` + `docker build` de un hola-mundo.
- F3 Cliente Windows: `docker.exe` estatico oficial (solo cliente, ~decenas MB) en dir en
  PATH + variable de usuario `DOCKER_HOST=tcp://127.0.0.1:2375`. Verifica desde `pwsh`:
  `docker version` (cliente Y servidor), `docker system df`, `docker build` hola-mundo.
- F4 Paridad con coolify-manager: `build-laptop --help` resuelve el cliente; un build
  real minimo y `system df/prune` responden. E2E completo en desechable (`cm-test-*`)
  SOLO con autorizacion explicita (D3, cuesta un build de ~10 min).
- F5 Fuera Desktop: desinstalador oficial (nunca borrado a mano) +
  `wsl --unregister docker-desktop` (y `docker-desktop-data` si aparece); verifica que
  `Programs\DockerDesktop` y `Local\Docker` desaparecen y mide el delta de `C-libre`
  (objetivo >= +4 GB). Rollback: reinstalar Desktop lo restaura; la distro Debian con su
  dockerd queda intacta.
- F6 limpiador-pc 0.7.0, fase `docker-scan`/`docker-clean` (refuerzo con borrado
  automatico NO interactivo, siempre con reporte `--guardar`):
  - Clase `resto-muerto` (borrado automatico con `--ejecutar`, sin pregunta):
    solo firmas de muerte eximente: distro NO listada en `wsl --list` + ruta bajo
    `Local\Docker|Programs\DockerDesktop`, o carpeta huerfana sin entrada de
    desinstalacion y sin ejecutable presente. En duda, aviso, jamas borrar.
  - Clase `reclamable` (daemon activo via API): `system df`/`builder prune` con umbral,
    solo con `--ejecutar`.
  - Guardarrailes: si el daemon responde, su `data-root` es intocable salvo prune por
    API; `mantenimiento/` y symlinks excluidos como en fase 7; seco por defecto.
  - Tests nuevos (muerto-no-listado se detecta, daemon-activo no se toca) + gate
    `sentinel check 04AA-1 --stages scripts/quality/stages-rust.json` (fmt/clippy/test)
    + rebuild via `POST /api/pc/reconstruir` + commit sin push.
- F7 Cierre: roadmap (`04AA-1` HECHA), commits (limpiador-pc; coolify-manager-rs solo si
  hubo codigo, no previsto), nota operativa (donde vive dockerd, `DOCKER_HOST`, arranque
  tras reinicio), `C-libre` final y matriz de verificacion.

## Gate y Definition of Done

- Gate codigo: `sentinel check` PASS asociado al commit (solo F6).
- DoD: carpetas Desktop fuera; `docker version` OK desde `pwsh` contra Debian;
  `build-laptop` resuelve cliente; `docker-clean --ejecutar` borra un resto muerto de
  prueba sin preguntar y con reporte; `C-libre` >= +4 GB; commits hechos, push = usuario.

## Decisiones pendientes del usuario (recomendada primera)

- D1 Loopback sin TLS (recomendado: solo escucha en tu propia maquina, como hasta ahora)
  vs con TLS (mas curro, mismo riesgo local).
- D2 `data-root` por defecto en Debian (recomendado) vs en `C:\tmp`.
- D3 Paridad con hola-mundo + comandos (recomendado) vs E2E desechable completo (~10 min).
- D4 Tarea programada al logon para dockerd (recomendado) vs arranque manual tras reinicio.
