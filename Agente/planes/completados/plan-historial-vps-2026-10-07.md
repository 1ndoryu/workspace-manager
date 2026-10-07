# Plan 07AA-4 — historial VPS persistente en el servidor + % en gráficos (2026-10-07)

## Objetivo

Que las muestras de CPU/RAM por despliegue de la tab `vps` perduren (sobrevivan a
recargas del navegador y cambios de origen) sin añadir carga al VPS ni demonio de
fondo, y que los gráficos del detalle muestren la última CPU% y RAM.

## Alcance

- Backend anota en `data/vps-historial.json` (gitignored por `data/*`) las sumas por
  sitio de cada snapshot que **ya** sirve `/api/vps/agente`: cero consultas extra.
- Nuevo `GET /api/vps/historial?clave=sitio:<nombre>|infra` (fail-closed, una clave).
- Frente: `useHistorialSitios` fusiona base del servidor + cola viva local (dedupe
  por `t`); `HistorialSitioDetalle` muestra última CPU% y RAM.
- Límite honesto (aceptado por el usuario): sin nadie mirando no hay muestras nuevas.

## No alcance

- Demonio/sondeo en segundo plano en el servidor; backfill de huecos pasados.
- Cambiar cadencias del frente (poll 5 s, muestra 30 s, topes 2000/7 d se reutilizan).
- Piezas bajo demanda (`PiezasSitio` queda igual: "sin pedir" es su reposo diseñado).
- Push (lo sube el usuario).

## Dependencias

- `glory-pulse/schema/ejemplo.json`: `ts` en ms epoch (calibrado 2026-10-07) → base
  temporal común frente+servidor, el dedupe por `t` es exacto.
- `NOMBRE_OK` (`puente.ts`) para validar claves; `data/*` ya gitignored.
- Patrón de tests: `node node_modules/tsx/dist/cli.mjs --test <fichero>.test.ts`.

## Fases verificables

- [ ] F1 Backend: `src/shared/historialVps.ts` (constantes + `normalizarTs` +
  `fusionarSeries` puras) + `src/server/vps/historial.ts` (`crearHistorial` con
  ruta/reloj inyectables: throttle 30 s/clave, tope 2000, poda 7 d, escritura
  atómica tmp+rename, nunca revienta la ruta) + `historial.test.ts` (agrupa por
  sitio, throttle, tope, poda, fichero corrupto → vacío, clave inválida → 400).
  Verificación: `tsx --test` en verde + `type-check` 0.
- [ ] F2 Ruta: hook en `/api/vps/agente` tras `enriquecerConSitios` + nueva ruta
  `/api/vps/historial?clave=` + tipo `VpsHistorialSitio` en `shared/types.ts`.
  Verificación: endpoint en vivo contra backend 8787 (200 + muestras creciendo).
- [ ] F3 Frente: `historialSitioVps(clave)` en `apiVps.ts` + `useHistorialSitios`
  carga la base una vez por clave y `seriePara` fusiona + `HistorialSitioDetalle`
  línea "última: x% · N MiB". Verificación: `type-check` 0 + serie con base
  servida en el detalle (navegador o smoke).
- [ ] F4 Cierre: gate forzado sin hallazgos nuevos en tocados, roadmap/completada,
  commit sin push.

## Estado

CERRADA (2026-10-07): F1–F4 verificadas (tests 9/9 + 20/20, type-check 0,
en vivo 4 muestras creciendo + 400 fail-closed, gate 0E/9W/1I/2H idéntico
a base). Evidencia en `Agente/completados/tareas-2026-10-07.md` (`07AA-4`).

## Próximo paso

Ninguno (cerrada). Si el usuario pide backfill o sondeo de fondo: nueva
tarea (hoy diferido a propósito: cero fondo).

## Verificación

- `npm run type-check` exit 0.
- `node node_modules/tsx/dist/cli.mjs --test src/server/vps/historial.test.ts` verde.
- `GET /api/vps/historial?clave=` en vivo + detalle con historia tras recarga.
- Gate: `POST /api/gate/analizar {"clave":"workspace-manager","forzar":true}` sin
  hallazgos nuevos atribuibles (baseline: anotar `resumen` antes de cerrar).

## Definition of Done

- Muestras anotadas solo con tráfico existente; fichero acotado y gitignored.
- Detalle muestra historia servida + última CPU%/RAM; localStorage intacto como cola.
- Tests + type-check + gate en verde; completada en `Agente/completados/`; plan
  movido a `Agente/planes/completados/`; commit sin push.
