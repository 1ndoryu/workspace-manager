# Plan 07AA-15 — kanban usable (2026-10-07)

Origen: el usuario ve el tab feo/roto: columnas sin scroll, flechas feas que
"no funcionan", tareas sin configuración. Pide: scroll-X, arrastre nativo,
menú contextual con las opciones, abrir lo mismo que TASKS, sin duplicar
lógica.

## Límites honestos (investigados, no supuestos)

- TASKS **no tiene URL por tarea** (detalle = modal por estado, sin
  deep-link). "Abrir en TASKS" = enlace a `http://127.0.0.1:4191` (pestaña
  nueva) + operaciones básicas inline. Testigo: `frontend/src/main.tsx:46-61`
  (solo `/`, `/arbitraje/`, `/privacidad/`, `/terminos/`, `/prueba/`).
- F1 **no expone leer-proyecto** (solo PUT/DELETE proyecto + GET sus tareas).
  La cabecera de columna queda numérica (`9001 · 3 tareas`); el nombre no
  existe en ningún endpoint. Proponer `GET /api/projects/:id` a TASKS queda
  como pendiente aparte, no se inventa estado local.
- El modal completo de TASKS (subtareas, tracking, dependencias, chat) NO se
  replica: el menú trae lo que el proxy puede (completar, renombrar,
  prioridad/urgencia, eliminar, abrir en TASKS). Esa es la frontera
  no-duplicación, documentada en el menú ("más opciones → Abrir en TASKS").

## Alcance / no alcance

- SÍ: scroll-X de columnas; DnD nativo HTML5 dentro/entre columnas
  (reemplaza las 4 flechas, que se eliminan); menú contextual por tarea
  (clic derecho + botón `···` para táctil/teclado); proxy
  `PUT /api/tareas/tarea/:legacyId` (texto/completado/prioridad/urgencia) +
  `DELETE /api/tareas/tarea/:legacyId` (204); completar con checkbox en fila.
- NO: replicar PanelConfiguracionTarea; editar subtareas/tracking/tags;
  nombre de proyecto en cabecera (sin endpoint); librería dnd externa
  (nativo basta); cambiar tasks-core (el puente F2 ya es adapter WM: la
  extensión vive ahí, TASKS valida con 422).

## Fases verificables

1. Proxy: `actualizarTarea`/`eliminarTarea` en `puente-tareas.ts` (reusa
   sesión D1 + transporte nativo + mapa de errores 404/422) + rutas
   `PUT/DELETE /api/tareas/tarea/:legacyId`. Test curl contra permanente con
   IDs temporales + limpieza.
2. Front: `apiTareas.actualizarTarea/eliminarTarea`; `ColumnaTareas` con
   `draggable` + `onDragStart/DragOver/Drop` (mismo `reordenar`/`migrar` del
   hook, cero lógica nueva de orden); `.tareasTab{overflow-x:auto}`.
3. Menú contextual: componente `MenuTarea` (tokens v2, `···` + contextmenu);
   acciones: completar, renombrar (inline), prioridad, urgencia, eliminar
   (confirm), abrir en TASKS (`http://127.0.0.1:4191`, `_blank`).
   Checkbox completar en la fila.
4. Cierre: puras+tests (payload real), type-check, build:server, UI viva
   (drag sintético con `new DataTransfer()` + clic menú), gate sin nuevos,
   docs, commit+push.

## DoD

Drag mueve dentro/entre columnas con persistencia (relectura); menú opera
(completar/renombrar/eliminar visibles tras relectura); sin flechas;
scroll-X con muchas columnas; cero regresión (20/20 + gate baseline).

## Verificación UI viva (2026-10-07, cerrada) — 2 bugs reales cazados

Temporales `9502-9505` + tareas `95021/95022/95026/95027` (todos borrados
tras verificar; seed `9001` intacto; `localStorage` devuelto a `[9001]`).

- Scroll-X: 6 columnas, `clientWidth 1284 < scrollWidth 1860`,
  `overflow-x:auto`, columnas `flex:none 300px`.
- Drag intra-columna (DataTransfer sintético `dos→uno`): orden persistido
  en TASKS (`dos:0, uno:1`); el primer intento (`uno→dos`) no cambió nada
  porque insertar-antes-del-siguiente es identidad — test mal diseñado,
  no bug.
- Drag inter-columna (`uno 9502→zona vacía 9503`): `proyectoId` reescrito,
  ambas columnas renumeradas, **pero la UI no se repintó** → BUG 1:
  `operar` llamaba a `cargar`, que con `enVuelo` en la mano hacía
  early-return (la relectura post-escritura nunca ocurría; F3 tenía el
  mismo defecto latente). Fix: `cargarInner` sin flag + `operar` lo llama
  directo; re-verificado (la UI se repinta sola tras soltar).
- Menú completar con clic real → la tarjeta **desapareció** → BUG 2: el
  PUT F1 es upsert de reemplazo y el parche no incluía `proyectoId`;
  TASKS lo puso a `null` (huérfana invisible, no borrada — testigo:
  replay manual devolvió `proyectoId:null`). Fix: `editar` inyecta la
  columna vía pura `parcheConColumna` (nuevo test `anti-huerfanas`);
  re-verificado (`completado:true, proy=9505`, la tarjeta sigue visible).
- Límite automatización: el `input` de alta es controlado React (el `fill`
  no habilita `+ agregar`); se usó `localStorage` + reload. El menú sí
  abre por clic real (ref) pero no por `.click()` sintético en `evaluate`
  (timing React) — no es bug de producto.
