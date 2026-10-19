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
   `Agente/planes/plan-orden-workspace-manager-2026-10-17.md`. Cerrados A (`.mjs`), B1–B6 (los
   falsos positivos, el último B4 en `varsense` `3375e18`), C (14 problemas reales; tablero 16 → 0),
   D, E, F, G, K, L1–L2, `17AA-3` (frentes 3 y 5: el doctor corre donde toca y lo dice, y el
   transporte se separa de `remoto.ts`) y `17AA-4` (frente 9: los binarios del manager, el nombre
   del área y el gestor de despliegues salen de la config; de paso, el `settings.json` de
   despliegues tenía dos dueños y el panel vps acusaba al taller de un problema suyo) y `17AA-1`
   (la nav ajena: ya venía escrita e integrada como `1988e02`; se verificó en el navegador a 1280,
   1040, 900 y 700 px y el defecto reportado —«taller» cortado a ~1040— no existe), el 8 (SOLID a
   fondo, `0302cf3`) y el 10 (accesibilidad: foco visible y teclado donde el rol lo prometía,
   medido en el navegador), y L1–L6 (documentación viva: skills, memorias, `AGENTS.md` y
   `Agente/documentacion/`). **Queda I (el resto del tablero), y se retoma por el pin de varsense
   de RESTAURANTE.**
1. `308A-5` — **Corregir hallazgos restantes de Sentinel y VarSense** (piso honesto + wins rápidos).
   Depende de 17AA-2 para no medir sobre reglas que cambian.

## Bloqueos y decisiones

- **Sentinel 0.7.21 (la versión de entonces; hoy el pin es 0.7.26)** — decisiones tomadas el 2026-10-11; ver `Agente/planes/` y el histórico.
- **`guard-sin-shim`** — bloqueado.
- **`10AA-2` F4** — cerrado el 2026-10-13 con limitación conocida.
- **`16A-5`** — **CERRADO (2026-10-17):** `quality:bump` sobre los 16 consumidores da 0 con
  problemas (Lock, Setup y Doctor en verde). Los dos family-B —WANDORIUS y RESTAURANTE— quedaron
  con `provisionPath` de forma distinta a propósito: el `setup.mjs` de WANDORIUS lo admite dentro
  del submódulo, el de RESTAURANTE lo prohíbe.
- **`16A-4`** — 3 consumidores declarados en `quality-sync.mjs` sin directorio en el área
  (`ONG AGAPE`, `freebuff-bridge`, `GLORYINSPECTOR`): no hay pin que validar. Ver 16A-4 bis.
- **`J` (17AA-2)** — semántica de `includePatterns`: **reemplaza** los defaults en vez de
  fusionarlos, así que 11 de 16 fichas congelaron una copia sin `**/*.mjs`. Un merge ciego no vale
  (4 proyectos Rust listan 3 patrones a propósito; 4 acotan a `frontend/**` y `scripts/**`).
  `analyzers.sentinel.profile` está en el tipo pero nadie lo lee: clave muerta, no preset.

## Tareas pendientes (orden de dependencia)

- `19AA-2` — **Frentes abiertos del `/goal` de calidad (no hechos el 2026-10-19).** Pendientes: organizar
  los 24 `PLAN-*.md` (cerrados a `planes/completados/`); README; detección de `.mjs` en Sentinel (o
  prueba de que ya la hay, con control positivo); SOLID (~25 archivos de más de 300 líneas);
  re-medir `REPOS_EN_PARALELO` 1/4/6 y documentar el riesgo de `ignorar` durante un escaneo en
  `cache.ts`; accesibilidad de la UI; limpieza de config privada fuera del repo; restos del frente 9
  (`test-utils.mjs`, `doctor.*.test.mjs`, `cm-sweep.sh`, `provision-89.sh`, `root-taller-89.sh:19,71`,
  `comprobacionesProyecto.ts:34,57`, `comprobacionesArea.ts:55`, `pc/ejecucion.ts:55`,
  `doctor/indice.mjs:204`, `lanzar.mjs:266,268`, `rcargo.test.mjs:76-87`, `release.mjs:11`
  `.quality-tools` vs `_quality-tools`); rutas viejas en AGENTS §2 y en la skill de workspace-manager;
  réplicas de gloryapi, Glory-Laminal, coolify-manager-rs, glory-lab y glory-pulse en `taller.json` o
  aviso; `/api/proyectos/doctor` tarda 14,3 s sin caché. Fuera de este repo: `glory-pulse` (compilar
  el .exe en la 89) y los falsos positivos de `dist/` en glory-harness (Sentinel), cada uno en su
  sesión. Criterio de hecho: cada frente con evidencia y commit, o marcado con su motivo.
- `18AA-1` — **Gate de calidad: el frontend corre en el laptop (error, AGENTS §1).** `frontend.mjs` del
  adaptador de calidad ejecuta `npm --prefix frontend run type-check|test:full|build` en el portátil,
  y `tsc` no existe allí (`npm` falla con «tsc no se reconoce»). Mismo fallo en
  `WANDORIUS/scripts/quality/adapters/frontend.mjs`. RESTAURANTE ya lo corrige en su adaptador
  (`scripts/quality/adapters/frontend.mjs`: sync Mutagen + ssh a la 89, reutilizando `rcargo.mjs`).
  Pendiente: llevar ese mismo patrón a WANDORIUS y a cualquier otro adaptador que llame a `npm`/`node`
  pesado desde el laptop; revisar también los pasos `sentinel` y `varsense` del gate, que hoy corren
  en el laptop (se midió: ~12 s y ~4 s). Otros proyectos con `frontend/package.json` (KAMPLES,
  MN-Inmobiliaria, NAKOMI, PROYECTO TASKS, glory-lab, Glory-Laminal) no tienen `quality.config.json`
  ni adaptador de gate: confirmar que ningún comando de `Arranque gate` ni de otro script de calidad
  les ejecuta `tsc` en el laptop.
- `17AA-5` — **Los gemelos `.ts`/`.mjs` no tienen guarda.** `src/shared/{area,binarios,puertos}.ts`
  y `src/server/plataforma/temporales.ts` se duplican a mano en `scripts/shared/*.mjs` porque un
  `.mjs` suelto no puede importar TypeScript, y nada comprueba que digan lo mismo: añadir
  `despliegueBin` fueron dos ediciones manuales. Un test que importe los dos y compare el resultado
  es barato, pero hoy no lo ejecuta nadie (las suites se invocan una a una), así que lo útil es que
  lo mire el doctor.
- `14AA-1` — **TRASLADADO (2026-10-14).** Plan cerrado, archivado en el área:
  `Agente/planes/completados/plan-taller-remoto-vps89-2026-10-14.md`.
- `14AA-4` — **PARCIAL (2026-10-15): dev público de MN** por Cloudflare Tunnel + Access
  (`mn-dev.wandori.us`). Falta el resto de proyectos publicables.
- `11AA-6` — **PENDIENTE DE HECHO EXTERNO (2026-10-11): NAKOMI, build TS de `main`.**
- `11AA-1` — **CÓDIGO INTEGRADO (2026-10-11)**: regla `html-nativo-en-vez-de-componente` y
  `aria-expanded` (`7a1668f` en glory-sentinel). Falta propagar el pin.
- `17A-2` — **L2 vivo: el Postgres del portátil escucha en `0.0.0.0:5432`.** El disco ya está
  corregido (`listen_addresses = 'localhost'`); falta reiniciar el servicio (hecho externo).
- `16AA-17` — **Higiene de WANDORIUS tras su alta en el taller**: le faltan el script
  `quality:check` y `.runtime/` en `.gitignore`. No bloquea nada.
- `16AA-11` — **Vulnerabilidades de cargo heredadas**, visibles desde el 2026-10-16. Medido el
  2026-10-17: **53 entradas en 7 proyectos**, y son casi todas el mismo par de avisos —`rustls`
  0.23.45 (y 0.23.37 en RESTAURANTE) contra el arreglo ≥0.23.46, y `zip` 1.1.4—, así que un
  `cargo update` por proyecto las cierra. El portátil no tiene toolchain: va por la 89 y hay que
  devolver el `Cargo.lock` al portátil para commitearlo. Es lo primero del bloque I tras el pin.
- `12AA-6` — `quality:doctor` usa el `sentinel` del PATH en vez del CLI del checkout del proyecto.
- `12AA-7` — `Arranque up` responde `ya-arriba` aunque el puerto no lo sirva el proceso nuevo.
- `16A-4 bis` — adapter de calidad legacy de RESTAURANTE y WANDORIUS frente al canónico
  (`bump.mjs` `pasosDe` prefiere el `scripts/quality/setup.mjs` del consumidor).
- `308A-8` — **Invertir la regla del escáner**: un directorio es proyecto solo con señal real, en
  vez de la lista negra `IGNORADAS` de `src/server/scanner/workspace.ts`.
- `04AA-1` — **REPLANTEADA (2026-10-05, veredicto REPLANTEAR).**
- `039A-1` — plan vivo del frente cero-deuda:
  `PROYECTO TASKS/Agente/planes/plan-cero-deuda-todos-proyectos-2026-09-03.md` §9.

## Planes activos

- `Agente/planes/plan-orden-workspace-manager-2026-10-17.md` — `17AA-2` (este encargo).

Archivados el 2026-10-17 en `Agente/planes/completados/`, con su DoD cumplido: `07AA-3`
(barrido de la consola), `07AA-5` (pestaña `tareas`), `299A-12` (`glory-pulse`) y `S2`
(saneamiento de AGENTS.md; su protocolo de backup sigue vivo como regla en
`Agente/documentacion/protocolo-backup-mutaciones-2026-10-17.md`).
