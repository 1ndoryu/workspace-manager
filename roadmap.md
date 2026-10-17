# Roadmap — workspace-manager

Cola viva: contexto, siguiente bloque, bloqueos y pendientes. **Sin completadas ni logs**: lo
cerrado vive en `Agente/completados/tareas-YYYY-MM-DD.md` y el log histórico del roadmap hasta
2026-10-17 está íntegro en `Agente/completados/roadmap-historico-2026-10-17.md`.

**Contexto.** workspace-manager corre en el portátil (front 5175, backend 8787) y es el mando del
taller: los proyectos se editan en el portátil y se compilan, prueban y analizan en la VPS 89
(`Arranque`). Debe funcionar igual **sin** la 89, degradando con elegancia. Frentes abiertos de
coherencia, agnosticismo y publicación: `Agente/planes/plan-orden-workspace-manager-2026-10-17.md`.

## Siguiente bloque ejecutable

0. `17AA-2` — **Poner workspace-manager en orden** (encargo de la usuaria, 2026-10-17). Plan:
   `Agente/planes/plan-orden-workspace-manager-2026-10-17.md`. Estado: A (`.mjs`), B1 (CVSS), B2
   (`cssInline*`) y C (14 problemas reales; tablero 16 → 2) cerrados. En curso: D/E/F/G.
1. `308A-5` — **Corregir hallazgos restantes de Sentinel y VarSense** (piso honesto + wins rápidos).
   Depende de 17AA-2 para no medir sobre reglas que cambian.
2. `17AA-1` — **Nav responsive: los destinos que no caben se van a un menú.** Pedido de la usuaria
   (2026-10-17): con ~1040 px «taller» sale cortado. Hay cambio ajeno sin commitear en
   `src/v2/ui/menu/`; se adopta, se termina, se prueba en el navegador y se commitea aparte.

## Bloqueos y decisiones

- **Sentinel 0.7.21** — decisiones tomadas el 2026-10-11; ver `Agente/planes/` y el histórico.
- **`guard-sin-shim`** — bloqueado.
- **`10AA-2` F4** — cerrado el 2026-10-13 con limitación conocida.
- **`16A-5`** — 5 consumidores con el pin de Sentinel atrasado (`8c2b65d8` frente a `2babcd4`):
  MN-Inmobiliaria, plugins-opencode, glory-pulse, WANDORIUS y RESTAURANTE. Se desbloquea al
  propagar el pin con `quality:bump`.
- **`16A-4`** — 3 consumidores declarados en `quality-sync.mjs` sin directorio en el área
  (`ONG AGAPE`, `freebuff-bridge`, `GLORYINSPECTOR`): no hay pin que validar. Ver 16A-4 bis.
- **`J` (17AA-2)** — semántica de `includePatterns`: **reemplaza** los defaults en vez de
  fusionarlos, así que 11 de 16 fichas congelaron una copia sin `**/*.mjs`. Un merge ciego no vale
  (4 proyectos Rust listan 3 patrones a propósito; 4 acotan a `frontend/**` y `scripts/**`).
  `analyzers.sentinel.profile` está en el tipo pero nadie lo lee: clave muerta, no preset.
- **Falsos positivos de 17AA-2, al final por encargo:** B4
  (`tokenDetection.duplicate.excludeTokens` no existe), B5 (`RESTAURANTE/excepciones-varsense.json`
  huérfano, nadie lo lee) y B6 (`limite-lineas` sobre archivos de test: Rust tiene techo 1000 para
  `/tests/` y `.test.ts`/`.test.mjs` se quedan con el 300 de producción).

## Tareas pendientes (orden de dependencia)

- `14AA-1` — **TRASLADADO (2026-10-14).** Plan cerrado:
  `Agente/planes/completados/plan-taller-remoto-vps89-…`.
- `14AA-4` — **PARCIAL (2026-10-15): dev público de MN** por Cloudflare Tunnel + Access
  (`mn-dev.wandori.us`). Falta el resto de proyectos publicables.
- `11AA-6` — **PENDIENTE DE HECHO EXTERNO (2026-10-11): NAKOMI, build TS de `main`.**
- `11AA-1` — **CÓDIGO INTEGRADO (2026-10-11)**: regla `html-nativo-en-vez-de-componente` y
  `aria-expanded` (`7a1668f` en glory-sentinel). Falta propagar el pin.
- `17A-2` — **L2 vivo: el Postgres del portátil escucha en `0.0.0.0:5432`.** El disco ya está
  corregido (`listen_addresses = 'localhost'`); falta reiniciar el servicio (hecho externo).
- `16AA-17` — **Higiene de WANDORIUS tras su alta en el taller**: le faltan el script
  `quality:check` y `.runtime/` en `.gitignore`. No bloquea nada.
- `16AA-11` — **Vulnerabilidades de cargo heredadas**, visibles desde el 2026-10-16 (4 en cada uno
  de coolify-manager-rs, glory-agent, glory-harness, KAMPLES, MN-Inmobiliaria).
- `12AA-6` — `quality:doctor` usa el `sentinel` del PATH en vez del CLI del checkout del proyecto.
- `12AA-7` — `Arranque up` responde `ya-arriba` aunque el puerto no lo sirva el proceso nuevo.
- `16A-4 bis` — adapter de calidad legacy de RESTAURANTE y WANDORIUS frente al canónico
  (`bump.mjs` `pasosDe` prefiere el `scripts/quality/setup.mjs` del consumidor).
- `308A-1` — **Centralizar el runtime del gate** (checkout compartido `.quality-tools/` +
  `sourcePathEnv`).
- `308A-8` — **Invertir la regla del escáner**: un directorio es proyecto solo con señal real, en
  vez de la lista negra `IGNORADAS` de `src/server/scanner/workspace.ts`.
- `07AA-5` — **ACTIVA (2026-10-07): pestaña `tareas` (kanban por proyecto)** con TASKS como
  dependencia (auth por cookie+CSRF, falta token servicio-a-servicio).
- `07AA-3` — **ACTIVA (2026-10-07): barrido de la consola** (142 → 0 accionable). Plan:
  `Agente/planes/plan-barrido-consola-2026-10-07.md`.
- `299A-12` — **ACTIVA (2026-09-29): `glory-pulse`**, agente en la VPS para tiempo real. Plan:
  `PLAN-glory-pulse-2026-09-29.md` (Rev.3 + §F0).
- `309A-2` — **ACTIVA (2026-10-05): detalle por sitio en una sola conexión.** Plan:
  `Agente/planes/plan-detalle-sitio-2026-10-05.md`.
- `0110A-3` — **APROBADA por la usuaria (2026-10-05, no volver a preguntar): detalle completo del
  despliegue.** Plan: `PLAN-vps-detalle-despliegue-2026-10-01.md`.
- `05AA-1` — **ACTIVA (2026-10-05): perfil dev adelgazado de Rust.** Plan:
  `Agente/planes/plan-rust-perfil-y-purga-2026-10-05.md`.
- `04AA-1` — **REPLANTEADA (2026-10-05, veredicto REPLANTEAR).**
- `039A-1` — plan vivo del frente cero-deuda:
  `PROYECTO TASKS/Agente/planes/plan-cero-deuda-todos-proyectos-2026-09-03.md` §9.

## Planes activos

- `Agente/planes/plan-orden-workspace-manager-2026-10-17.md` — `17AA-2` (este encargo).
- `Agente/planes/plan-barrido-consola-2026-10-07.md` — `07AA-3`.
- `Agente/planes/plan-detalle-sitio-2026-10-05.md` — `309A-2`.
- `Agente/planes/plan-rust-perfil-y-purga-2026-10-05.md` — `05AA-1`.
- `PLAN-glory-pulse-2026-09-29.md` — `299A-12`.
- `PLAN-vps-detalle-despliegue-2026-10-01.md` — `0110A-3`.
