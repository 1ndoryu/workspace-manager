# Plan 05AA-4 — dev `parado` + punto verde + botones en detalle (2026-10-05)

Pedido del usuario: `dev deriva puerto 8799 libre (caido?)` no es un problema
— es un servicio detenido normal. Pide: (1) no contar parado como problema,
(2) punto verde en la caja del mapa si está arrancado, (3) al clicar una caja,
botones arrancar/detener/bitácora/abrir arriba en el panel izquierdo.

## Objetivo

Nuevo estado `parado` (todos los puertos libres = detenido normal, exit 0,
seriedad null con botones) sin tocar `deriva` real (duplicado, ocupado
ajeno, sin-probe, parcial). Mapa con punto verde si `bajo-mando`. PanelDetalle
con fila de mando dev arriba al seleccionar.

## No alcance

- No se toca `GloryTmpSweep`, sccache, perfiles Rust ni el gate.
- No cambia `sin-boton`/`no-aplica`/`huerfano` ni la trampa (es agnóstica a exit).
- No `up --all`, no matar a ciegas, no tocar protegidos.

## Fases

- [x] F0 registrar (roadmap entrada 38 + este plan).
- [x] F1 doctor: `parado` si todo el detalle es `libre`; assert lo acepta
      como evidencia; `codigoSalida` 0; `status` 0.
- [x] F2 front consola: `parado` NO genera entrada (correccion del
      usuario: detenido no va en problemas); se opera desde el detalle.
- [x] F3 mapa: `<circle>` verde en el techo si `bajo-mando` (clave del
      proyecto); tooltip/leyenda mínima. Excepción explícita del usuario a
      la regla monocroma (solo el punto).
- [x] F4 detalle: sección mando dev pegada a la cabecera (estado +
      motivo + 4 botones; literales duplicados de la consola con comentario
      de sincronía, sin módulo nuevo).
- [x] F5 verificar: `type-check` 0, `doctor --all` + `--assert` sin fallos,
      `status glory-harness` exit 0, trampa 7/8 (FAIL preexistente
      `pendiente-onboarding test-10-pasos-opencode`, verificado en HEAD sin
      cambios), `vite build` OK; commit sin push; cierre docs.

## Definition of Done

- `status glory-harness` detenido → `parado`, exit 0; consola sin error dev
  para él pero con botones; mapa sin punto; detalle con botones.
- Arrancado → `bajo-mando`, punto verde en su caja.
- `deriva` real (duplicado/ajeno) sigue error + exit 2.
- `doctor --assert` y trampa en verde.

## Riesgos

- El conteo `todos` incluye líneas null (ya lo hace con `bajo-mando`):
  parado suma líneas visibles igual que un arrancado. Aceptado por
  coherencia; el filtro `dev` las agrupa.
