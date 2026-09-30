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

## Fases de ejecución (tras aprobar el inventario)

1. **F1 — cerrar.** Una receta de cierre en `Caja` (el × canónico) y
   migración de todas las variantes. Verifica: captura por panel
   antes/después + `type-check` 0.
2. **F2 — quick wins.** Duplicaciones exactas al dueño existente
   (formateadores, clases, chips). Una por commit, verificación visual
   por frente.
3. **F3 — extracciones.** Solo lo que el inventario marque con dueño
   nuevo claro (`usePersistida`, `usePoll`, errores server). Sin
   monolitos: cada extracción con sus llamadas migradas y tests donde
   haya.
4. **F4 — cierre.** `type-check` 0, `vite build` OK, sentinel+varsense
   sin hallazgos nuevos (0 preexistente 2026-09-29: no subir conteo),
   smoke por tab en vivo, commit sin push.

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
