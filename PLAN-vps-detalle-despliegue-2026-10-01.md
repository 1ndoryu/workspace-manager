# PLAN — Detalle completo del despliegue (0110A-3, 2026-10-01)

## Objetivo

Al hacer clic en un despliegue se veía antes mucha más información (las
7 piezas legacy: salud, stats, inspección, eventos, bd, diagnóstico,
logs) y hoy solo una lista de contenedores. Recuperar esa riqueza de
forma ordenada y útil, con gráficos de recursos por despliegue con
intervalo de tiempo — **sin resucitar el problema que la mató**: el
`/api/vps/detalle` legacy tarda 120,6 s medidos (7 piezas SSH en serie;
hoy `nakomi` ni responde en 120 s). Nada de este plan puede colgar la
tab.

## Inventario de datos (rápido vs pesado, verificado 2026-10-01)

- **Rápido (pulse, tick 5 s, ya en el frontend):** por contenedor
  estado/salud, cpu %, mem/límite, red acumulada, sitio+dominio
  resueltos por el backend. Base del detalle.
- **Medio (audit, cadencia 60 s, ya cableado):** cpu/mem/disco del
  host + carga. Contexto, no por despliegue.
- **Pesado (manager SSH, segundos–minutos, hoy colgado):** logs,
  inspección, eventos, diagnose, db-stats. Solo bajo demanda estricta.

## Diseño

Lateral de detalle por secciones, cada una independiente (si una falla
o tarda, las demás se ven — degradación parcial como el legacy, pero
con abort real):

1. **Resumen** (siempre, instantáneo): estado, nº contenedores,
   dominio, salud, edad del snapshot.
2. **Recursos del despliegue** (instantáneo + historial): cpu/mem del
   sitio + minigráficos con los mismos chips de rango (30 min–1
   semana) del panel global. Requiere historial **por sitio**: anillo
   propio (1 muestra/30 s por sitio, tope ~2 000 ≈ 16 h; ~14 sitios ×
   pocos números — cabe en localStorage sin tocar el historial
   global). El vivo (5 s) se pinta encima mientras se mira.
3. **Contenedores** (instantáneo): la lista actual (rol, estado, cpu,
   mem/límite, red) — lo que ya hay, ordenado igual que la tabla.
4. **Logs** (bajo demanda): botón por contenedor «ver logs», `logs
   --lines 100` con timeout 15 s y abort al cerrar/cambiar de
   despliegue. Sin auto-poll (decisión; el auto-poll se propone como
   extra).
5. **Inspección / Eventos / Diagnóstico** (bajo demanda, plegados por
   defecto): cada pieza con su timeout (15–20 s), su error visible y
   su reintento. Si el manager sigue colgado como hoy, la sección lo
   dice en vez de colgar la tab.

## Fases verificables

1. **F1 — secciones instantáneas.** Resumen + contenedores con el
   diseño por secciones (sin piezas pesadas aún). Verifica: clic en 3
   despliegues, detalle <1 s tras el snapshot, `type-check` 0.
2. **F2 — historial por sitio + gráficos.** Anillo por sitio, chips de
   rango por despliegue, chispas cpu/mem/red del sitio. Verifica:
   rango 30 min con datos tras 30 min abierto (o datos parciales
   honestos), persistencia tras recarga, tamaño de localStorage
   medido y registrado.
3. **F3 — piezas pesadas bajo demanda.** Logs + inspección/eventos/
   diagnóstico con timeout/abort por pieza. Verifica: cada pieza
   tarda >15 s → error visible sin tumbar el resto; cerrar el detalle
   aborta lo en vuelo (sin `setState` post-cierre).
4. **F4 — cierre.** `type-check` 0, `vite build` OK, calidad sin
   hallazgos nuevos, verificación en vivo completa, commit sin push.

## No alcance

- Auto-poll de logs ni streaming (propuesta separada si se pide).
- Resucitar `/api/vps/detalle` tal cual (7 en serie = 120 s; muerto).
- El endpoint de detalle por sitio en pulse (`309A-2`, propuesto):
  si se hace, F3 puede consumirlo en vez del manager — dejar el
  punto de enganche, no esperarlo.
- Métricas que no existen (IO por contenedor → 0110A-1 mide el host).

## Definition of Done

- Clic → resumen + gráficos con rango + contenedores, todo <1 s.
- Piezas pesadas opcionales, con timeout, abort y error visible.
- Ninguna pieza puede colgar la tab (verificado provocando timeout).
- Commits sin push (push = usuario).

## Decisiones para el usuario (no bloquean F1)

- ¿Logs con auto-refresh o solo bajo demanda?
- ¿Qué piezas pesadas entran en F3 (todas o solo logs+inspección)?
- Tamaño del anillo por sitio si 2 000 muestras parece mucho/poco.
