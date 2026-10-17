# Plan — Poner workspace-manager en orden (2026-10-17)

Encargo de la usuaria. **Objetivo:** dejar workspace-manager coherente, correcto y agnóstico:
sin problemas reales abiertos, sin incoherencias con el taller de la VPS 89, sin falsos
positivos, sin hardcodeo, con análisis que cubra también los `.mjs`, con SOLID verificado, con
README y con los planes terminados y organizados.

**Punto de partida medido** (`GET /api/consola/problemas`, 2026-10-17T09:35Z): **440** problemas
repartidos en `sentinel` 350, `vulnerabilidad` 65, `salud` 20, `sinPush` 2, `sinCommit` 2,
`taller` 1. De los 440, **solo 2 son de workspace-manager**; el grueso está en RESTAURANTE (259),
KAMPLES (121), MN (13), NAKOMI (10) y PROYECTO TASKS (10).

## Decisiones de la usuaria (2026-10-17)

- **Alcance: todo el tablero**, por bloques y por proyecto; primero workspace-manager y las
  herramientas, después RESTAURANTE y KAMPLES.
- **`.mjs`: se arregla el núcleo de `glory-sentinel`** (mapeo de extensión y normalización en la
  comprobación de `aplicaA`) **más** el `sentinel.config.json` de workspace-manager.
- **Planes: se revisan uno a uno**, pero con criterio: son de agosto-septiembre y el área ha
  cambiado mucho, así que solo se salva lo que siga siendo una mejora importante o un pendiente
  que sume; el resto se archiva.
- **El nav ajeno de `src/v2/ui/menu/` (17AA-1) se adopta y se termina.**

## Diagnóstico (causa, no síntoma)

| # | Frente | Causa raíz | Dónde |
|---|---|---|---|
| 1 | `.mjs` sin analizar | El config sobrescribe `includePatterns` sin `**/*.mjs`, y `languageIdForFile` no mapea `.mjs` → `plaintext`, así que ninguna regla casa por `aplicaA`. La regla existe: `lineCounter.ts:208` da techo 300 a `.mjs` y cita `doctor.mjs` por su nombre. | `sentinel.config.json:23`, `core/language.ts:3`, `staticAnalyzer.ts:47,74` |
| 2 | Falsos positivos | Cinco defectos de herramienta distintos (ver Bloque B). | `vulnerabilidades-parseo.ts`, `estiloInline.ts`, `cssParser.ts`, `tokenRules.ts`, `analisisRapido` |
| 3 | Incoherencia con la 89 | De los seis proyectos del taller, **solo KAMPLES declara `analisisEn: "dev89"`**; los otros cinco se analizan en el portátil, contra AGENTS §7. Además `modoAnalisis` cae a `'local'` por defecto. | `registro.json`, `src/server/gate/remoto.ts:71` |
| 4 | Hardcodeo | `TALLER_HOST = 'dev89'` con `host` disponible en `taller.json`; la ruta del área repetida 9 veces; listas de proyectos dentro de `scripts/quality*`. | `src/server/taller/estado.ts:25`, `scripts/quality-sync.mjs:46` |
| 5 | SOLID | `scripts/dev/doctor.mjs` con 2255 líneas y `remoto.mjs` con 1043; `src/server/gate/` con 12 archivos (máx 10). | — |

## Bloques

Cada bloque se cierra con sus tests, su entrada en `Agente/completados/tareas-2026-10-17.md` y
su commit. El orden importa: **A y B van antes que C**, porque cambian lo que el tablero mide.

- **A — `.mjs` en Sentinel. HECHO (2026-10-17).** Causa doble: `includePatterns` propio no listaba
  `**/*.mjs` (esa clave **reemplaza** los defaults, no fusiona) y `languageIdForFile` no mapeaba
  `.mjs`, así que el documento llegaba como `plaintext` y toda regla lo descartaba por `aplicaA`.
  `ba6d9c7` (11-oct) había hecho solo la mitad: los defaults y el techo de 300 líneas de
  `lineCounter.ts`, que llevaba desde entonces siendo código muerto. Arreglado en el núcleo con
  `extensionCanonica` en `core/language.ts`, aplicada en `staticAnalyzer.ts` y `portableRules.ts`.
  glory-sentinel `d99f4c5`, versión 0.7.25, suite **881 passing / 0 failing**, certificado
  (`origen=ejecutada`). Pin propagado a 16 manifiestos.
  **Delta medido:** workspace-manager pasa de **2 a 16 hallazgos**; los 14 nuevos son de `.mjs`
  y 13 son reales. La excepción es `todo-prosa-sin-marcador` sobre `doctor.mjs:1630`, que casa
  la palabra española «todo» → pasa a B.
- **B — Falsos positivos de herramienta.** Los cinco con evidencia recogida: CVSS vector en
  `vulnerabilidades-parseo.ts`; comentarios en `cssInlineReact`; `var(--token)` en
  `propiedadProhibida`; `tokenDetection.duplicate.excludeTokens` en VarSense; y el destino de
  `RESTAURANTE/excepciones-varsense.json`, que hoy es una adjudicación firmada que ningún
  programa lee. **Añadido por A:** `todo-prosa-sin-marcador` casa «todo» en prosa española
  (`doctor.mjs:1630`, «todo verde = 0»); la regla busca el marcador inglés `TODO` y necesita
  contexto para no leer el artículo español.
- **C — Problemas reales de workspace-manager.** 16 tras A. De `.mjs`: `directorio-abarrotado` en
  `scripts/dev/` (20 archivos) y `scripts/quality/` (11); `limite-lineas` en `doctor.mjs` (1716
  efectivas), `remoto.mjs` (814), `doctor.test.mjs` (513), `remoto.test.mjs` (398) y `bump.mjs`
  (460), con sus niveles 2–4 en `doctor.mjs`; `import-muerto` ×2 en `agregado-8787.mjs` y ×1 en
  `sync-gate-schema.mjs`. Heredado: `directorio-abarrotado` en `src/server/gate/` (12, de
  `16AA-14`). **Añadido:** el backend escucha en `0.0.0.0:8787` (PID 9488), contra AGENTS §1.
  Los `limite-lineas` de `doctor.mjs`/`remoto.mjs` son la misma deuda que ataca E: se resuelven
  ahí, no con dos arreglos.
- **D — Coherencia con el taller.** `analisisEn: "dev89"` en las cinco fichas que faltan, con
  validación contra local al activarlo (AGENTS §7); `modoAnalisis` por defecto alineado con
  `modoPorDefecto` de `taller.json`; `TALLER_HOST` leído de `taller.json`.
- **E — SOLID y agnóstico.** Partir `doctor.mjs` y `remoto.mjs` por responsabilidad; un módulo
  único de rutas del área en vez de 9 literales; sacar de `scripts/quality*` las listas de
  proyectos que duplican `registro.json`.
- **F — README.** No existe. Uno en condiciones: qué es, cómo se arranca, dónde vive el estado,
  y el reparto portátil/89.
- **G — Planes.** Revisar los 24 `PLAN-*.md` de la raíz y los 5 de `Agente/planes/`, uno a uno;
  crear `Agente/documentacion/`; archivar lo terminado y lo que ya no sume.
- **H — Nav ajeno (17AA-1).** Terminar el recorte del nav, probarlo en el navegador y commitearlo
  aparte.
- **I — RESTAURANTE y KAMPLES.** Los 259 y 121 hallazgos, por bloques, tras cerrar las
  herramientas (A y B cambian el recuento).
- **J — El arreglo no llega a los demás consumidores (nuevo, de A).** 11 de 16 fichas declaran
  `includePatterns` propio sin `**/*.mjs`, así que la mitad del arreglo solo vale para
  workspace-manager. La causa es la semántica de la clave: **reemplaza** los defaults en vez de
  fusionarlos (`config.ts:229`), de modo que cada ficha congeló una copia de los defaults de su
  fecha. Un merge ciego no vale: `glory-agent`, `glory-pulse`, `GLORYPORT` y `limpiador-pc`
  listan 3 patrones a propósito (proyectos Rust sin JS) y `RESTAURANTE`/`NAKOMI`/`PROYECTO TASKS`/
  `WANDORIUS` acotan a `frontend/**` y `scripts/**`. `analyzers.sentinel.profile` está declarado
  en el tipo pero ningún código lo lee: es una clave muerta, no un preset. **Decisión pendiente
  de la usuaria.**

## Criterio de hecho

Cero problemas reales abiertos y cero falsos positivos pendientes; ninguna incoherencia con el
taller de la 89; los `.mjs` analizados con el mismo rigor que el resto; SOLID cumplido, sin
hardcodeo, con README; planes terminados y organizados.

## Estado

**Bloque en curso:** B. **Próximo paso:** recoger la evidencia de los seis falsos positivos y
corregir la regla que los produce, empezando por `todo-prosa-sin-marcador` (medido en A).
**Cerrado:** A (glory-sentinel `d99f4c5` + pin en 16 manifiestos).
**Pendiente de decisión de la usuaria:** J (semántica de `includePatterns`) y, en D, si las cinco
fichas pasan a `analisisEn: "dev89"`.
