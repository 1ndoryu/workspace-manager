# Plan 08AA-6 — Kanban de columnas fijas + alta rápida por columna (2026-10-08)

Objetivo: la tab `tareas` deja de usar columnas manuales (`legacy_id` en localStorage)
y pasa a una columna fija por proyecto no-ignorado del workspace, con alta rápida
inline por columna al estilo `InputNuevaTarea` de TASKS.

Decisiones del usuario (08AA-6 Q&A):
- Ignorados = `config.ignorados` del workspace-manager (el snapshot ya los excluye).
- Alta = input rápido inline por columna (no modal completo, no deep-link).
- Fijas del todo: fuera caja `agregar` y fuera X `quitar`; orden = snapshot WM.
- Sincronización pura (aclaración 08AA-6): WM crea solo los proyectos en TASKS
  según el snapshot. Ignorado → sin columna (el proyecto TASKS queda intacto).
  Repo nuevo en WM → proyecto nuevo en TASKS en la próxima carga. Autorizado a
  escalar TASKS si hace falta (no hizo falta: el upsert `PUT /api/projects`
  con `payload` ya existe).

## Alcance / no alcance

Sí: endpoint proxy listar-proyectos, sincronización WM→TASKS por `wmClave`
en `payload` (crea los que faltan, nunca borra), columnas fijas,
`+ Añadir` por columna vía PUT-upsert existente, retirar add-box/X y
columnas en localStorage, docs (`AGENTS.md` §Tareas, roadmap, completada).
No: modal completo de TASKS en WM, borrar proyectos TASKS, reordenar
columnas a mano, tocar sesión D1 / transporte / núcleo vendorizado.

## Contratos y hechos base

- TASKS `GET /api/dashboard` → `data.proyectos[]` con `{id (=legacy_id),
  nombre, estado, orden, ...}` (`proyeccion.rs:209` `project_object` +
  `object_with_id`; `dashboard.rs:151`). El `payload` del proyecto se mezcla a
  raíz, así que `payload.wmClave` llega como `wmClave` a raíz (llave del sync).
- TASKS `PUT /api/projects/:legacy_id` (`UpsertProjectRequest`:
  `productivity.rs:30-48`) acepta `{nombre, payload}` con el resto por
  defecto (`estado` = `activo`); el payload libre ≤1 MB es la llave `wmClave`.
  Cero cambios en TASKS.
- WM snapshot `GET /api/workspace` → `proyectos[{id, clave, ...}]`, ignorados
  ya filtrados por el escáner (`scanner/workspace.ts:93-99`).
- Sync (`sincronizar-proyectos.ts`, puro salvo `crear` inyectado): por cada
  entrada WM en orden de snapshot → empareja por `wmClave` exacto; si falta,
  `PUT /api/projects/:id` con `{nombre: id-WM, payload: {wmClave: clave}}` e
  id `Date.now()*1000 + resto` (espejo de `generarIdTarea` TASKS,
  `repeticionTareas.ts:15-19`; se salta ids ya ocupados). Secuencial (simple,
  sin carreras). Sin `wmClave` (demos 9001/9002) → sin columna, intactos.
- Crear = PUT upsert existente: `PUT /api/tareas/tarea/:id` con
  `{texto, proyectoId, orden}` (`rutasTareas.ts:123`, `puente.actualizar`).
- `validarParche` exige `texto` 1..1000 (`tarea-unitaria.ts:29`).
- Renombrar carpeta WM = clave nueva = proyecto TASKS nuevo; el viejo queda
  huérfano oculto (nunca se borra nada en TASKS desde WM).

## Fases

1. **F1 backend sync**: `ProyectoPuente` + `wmClave`;
   `sincronizarColumnas({wm, task, crear, ahora})` puro + tests;
   `puente.crearProyecto()` (`PUT /api/projects/:id`) + ruta
   `GET /api/tareas/proyectos` que sincroniza y devuelve
   `{proyectos: [{clave, nombre, legacyId}]}` en orden snapshot; `leerWm`
   inyectado (producción: `snapshotArea(false)`). Tests puente + rutas.
   Verificar vivo: `curl 127.0.0.1:8787/api/tareas/proyectos` crea los
   proyectos que falten y devuelve 18 columnas.
2. **F2 hook** (`usePanelTareas.ts`): columnas del proxy (directas, sin
   emparejado en front), carga por `legacyId`, `crear(columna, texto)` con id
   espejo-TASKS; retirar `agregarColumna/quitarColumna` +
   `leer/guardarColumnasTareas`, `COLUMNAS_DEFECTO_TAREAS`, `parsearLegacyId`
   si quedan sin uso.
3. **F3 UI**: `PanelTareas.tsx` sin caja agregar; `ColumnaTareas.tsx` título =
   nombre WM + pie `+ Añadir` inline (Enter crea, error visible); fuera X.
   Estilo monocromo v2 existente.
4. **F4 cierre**: `AGENTS.md` §Tareas (columnas fijas + sync), type-check,
   tests, gate re-analizar sin nuevos, roadmap HECHA + completada,
   commit + push.

## Estado

- F1 listado hecho (endpoint devuelve TASKS crudo); falta sync (wmClave +
  crear + cablear `leerWm`).

## Próximo paso

- Implementar sync y medir vivo contra TASKS (crea ~16 proyectos).

## Definition of Done

- Columnas = proyectos snapshot no-ignorados, ni añadir ni quitar a mano.
- `+ Añadir` por columna crea tarea visible tras relectura (evidencia en UI
  viva); columna sin emparejado lo dice, no finge.
- `npm run type-check` 0; tests verdes; gate sin hallazgos nuevos; commit en
  `main` + push.
