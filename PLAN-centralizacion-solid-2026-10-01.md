# PLAN — Centralización: botón cerrar + auditoría SOLID (0110A-2, 2026-10-01)

## Objetivo

El botón de cerrar se ve distinto en cada panel y no debería: es el
síntoma. Este plan lo centraliza y aprovecha para auditar la app entera
buscando lo mismo — lógica duplicada que ya tiene (o merece) un único
dueño — y centralizarla con la disciplina del área (refactors reales,
sin fachadas para bajar conteo; precedente 308A-5).

## Fase 0 — Auditoría profunda (solo lectura, su entregable es inventario)

Barrido completo de `src/` (frontend + server) buscando
duplicación/no-centralización, con evidencia por ruta y símbolo. Foco
pedido por el usuario (no exclusivo):

1. **Botón cerrar**: `Caja` ya centralizó el × (`Button cuadrado
   pequeno`, 299A-7) pero el detalle vps usa `Button pequeno` con texto
   «× cerrar», y puede haber más variantes (× nativos, textos
   «cerrar/cancelar»). Inventariar todas y decidir UNA receta.
2. **Patrones de panel**: estados carga/vacío/error (`docsVacio`,
   `vpsAviso`, spinners `…`), botones recargar (cada panel enrosca el
   suyo), metas de cabecera («en vivo · hace Xs» vs resto), filas de
   tabla/lista, chips (navegador vs rangos vps — ya reutilizado, dejar
   constancia), badges de estado (`vpsEstado` vs `reposFila*`).
3. **Utilidades transversales**: formateadores (`fmtBytes` vive en
   `PanelVps.tsx` y ya lo importa Recursos — ¿a `shared/`?),
   persistencia en localStorage (claves `workspaceManager:*`
   dispersas: fila, historial, rango — ¿hook único `usePersistida`?),
   polling/SWR manual por panel (cada uno su `setInterval`+abort —
   ¿`usePoll` central con pausa en oculta?), fetch con caché manual
   (`apiVps.ts`, `apiRepos.ts`, `apiPc.ts` — ¿capa común?).
4. **Server**: respuestas `json()`/errores, validación de nombres,
   timeouts/colas (`puente.ts` vs `pc/ejecucion.ts`), redacción de
   secretos, caché con TTL (`agente.ts` 5 s vs resto ad-hoc).

Reglas del inventario: cada hallazgo con rutas, conteo de
duplicaciones, dueño propuesto (existente o nuevo) y veredicto
honesto — **centralizar / dejar duplicado a propósito (y por qué) /
no tocar (fuera de alcance)**. Lo cosmético sin dueño claro no se
migra.

## F0 — Auditoría (HECHA 2026-10-01, 3 subagentes solo lectura)

Inventario con veredictos (evidencia completa en el hilo 2026-10-01):

**Centralizar:** (1) cerrar/quitar → `Caja.onCerrar` (× canónico); variantes a
migrar: `PanelVps.tsx:311` (`Button pequeno` «Cierra el detalle»),
`PanelDetalle.tsx:57-58` (documentada, migrar igual). `fjTagQuitar`/`ejQuitar`
son quitar-tag, NO cierres: se dejan. (2) formato: `fmtBytes` (PanelVps, KiB…),
`formatearTamano` (Navegador, B/KB/MB), `gb` (PC) → `shared/format.ts`;
fechas `toLocaleString` ×3 + `fechaCorta` + `slice(0,7)` ×5 → mismo dueño.
(3) localStorage: 7 claves, try/catch+warn repetido 7× → `shared/storage.ts`.
(4) `index.ts` legacy duplica `http.ts` (`json`, `leerBody`, `leerArchivo`
idénticos) → borrar. (5) `NOMBRE_OK` idéntico en `puente.ts:18` y
`rutasVps.ts:28` + validación en 4 sitios → una en `puente.ts`.
(6) single-flight idénticos (`analizador.ts` + `vulnerabilidades.ts`
`Map<clave,Promise>`) → helper común en `gate/`. (7) SSE duplicado
(`rutasPc.ts` scan/limpieza) → helper. (8) casts `leerBody`
`typeof x==='string'` ~11× → `campoStr(body,…)` en `http.ts`.

**Dejar duplicado (motivo):** `docsVacio` 18 usos (solo clase compartida,
textos distintos, correcto); cachés TTL distintas (5 s/60 s/10 min/persistidas —
parámetros por necesidad); timeouts por llamada (8 s–600 s justificados);
`encolar` puente vs ejecucion (dominios distintos); `redactar`+`sanearJson`
(ya colaboran); 3 familias anti-traversal (archivos/snapshot/diff, legítimas).

**No tocar:** logger/Toaster/`Selector`/`Resizer`/`FilaCajas` (ya centrales),
`setTimeout(0)` SSE.

## Fases de ejecución

1. **F1 — cerrar.** `PanelVps:311` y `PanelDetalle:57-58` migran al ×
   canónico de `Caja` (`onCerrar`). Verifica: `type-check` 0 + captura vps
   con detalle (× único arriba-derecha).
2. **F2 — `shared/format.ts`.** Dueño nuevo: `fmtBytes` (el de PanelVps manda:
   KiB/MiB/GiB), `formatearTamano` se jubila, `gb` se reimplementa sobre
   `fmtBytes` o se deja como etiqueta GB con 2 decimales (misma firma),
   `fechaCorta` + `fechaHora` (reemplaza los 3 `toLocaleString` sueltos) +
   `hashCorto` (los 5 `slice(0,7)`; el `slice(0,10)` legacy de DetalleProyecto
   se deja: archivo legacy fuera de v2). Migra importadores; verifica por
   frente (vps, navegador, pc, repos).
3. **F3 — `shared/storage.ts`.** Dueño nuevo: `leerClave`/`guardarClave`/
   `borrarClave` (JSON + try/catch + warn central, misma semántica actual).
   Migra las 7 claves (`layout`, `seleccion`, `ui`, `vps-historial`,
   `vps-rango`, `fila:*`, `mapaV2:estado`). Verifica: recarga conserva
   layout/historial/anchos.
4. **F4 — server.** (a) borrar `json`/`leerBody`/`leerArchivo` legacy de
   `index.ts` (usan los de `http.ts`); (b) `NOMBRE_OK`+`validarNombre` solo
   en `puente.ts`, `rutasVps.ts` importa; (c) `campoStr` en `http.ts` y
   migra los ~11 casts; (d) helper SSE en `rutasPc.ts` (scan+limpieza);
   (e) single-flight común en `gate/` para analizador+vulnerabilidades.
   Verifica: `type-check` 0 + smoke tsx de los módulos tocados.
5. **F5 — cierre.** `type-check` 0, `vite build` OK, sentinel+varsense sin
   hallazgos nuevos (0 preexistente 2026-09-29: no subir conteo), smoke por
   tab en vivo, commit sin push, roadmap nº30 a HECHA.

## No alcance

- Cambios de comportamiento o de identidad visual (solo unificar lo
  que ya existe; si dos variantes tienen intención distinta, se
  documenta y se dejan).
- Refactors de gran superficie de API/UI (límite 308A-5, decisión
  2026-08-31).
- La tab vps/detalle (frente 0110A-3) ni pulse (0110A-1): aquí solo se
  los consume como casos del inventario.

## Definition of Done

- Un solo botón cerrar en todo el frontend (o variantes documentadas
  con motivo).
- Inventario archivado como evidencia; cada centralización con su
  verificación.
- Calidad sin regresión: `type-check`, build, sentinel/varsense.
