# Plan: catálogo COMPLETO de reglas de sentinel en el editor, ordenado en tabs

> Estado: propuesto · Autor: buffy · Fecha: 2026-08-29
> Fuente real: runtime sentinel **v0.7.4** fijado (`GlorySentinel/versions/0.7.4/out/config/ruleRegistry.js`
> y `defaultRules.js`), no el esquema del manager ni inventario.

## 1. El problema (confirmado contra el runtime real)

El editor de config muestra "0 de 14 reglas" y el usuario sospecha que es poco.
Contra `ruleRegistry.js` de la versión fijada (0.7.4):

- El registro oficial expone **105 reglas configurables**, no 14.
- Cada regla del runtime trae `id`, `nombre`, `categoria`, `severidadDefault`.
- Las **105 se agrupan en 8 categorías** (campo `categoria` de cada regla):
  `react-patrones (30)`, `glory-schema (17)`, `estructura-nomenclatura (14)`,
  `wordpress-php (14)`, `patrones-prohibidos (13)`, `rust-patrones (7)`,
  `limites-archivo (5)`, `seguridad-sql (5)`.
- De los 14 ids del catálogo actual, **3 NO existen en el registro**
  (`css-adhoc-button-style`, `sqlx-query-as-sin-macro`, `sqlx-query-sin-macro`):
  el catálogo estaba incompleto Y con ids basura.

Objetivo: mostrar TODAS las 105 (con sus defaults reales), organizadas en
**tabs por las 8 categorías** para que sean navegables, y compactar las filas.

## 2. Decisiones de diseño

- **Catálogo dirigido por datos, no hardcode en UI.** Las 105 reglas viven en
  `src/shared/gate/reglas.ts` como un array tipado `{ id, nombre, categoria,
  severidad }` extraído del runtime real. El componente las agrupa por
  `categoria` para armar los tabs: agregar/cambiar categorías NO toca la UI.
- **Defaults reales del esquema, no inventados.** La severidad por defecto sale
  de `severidadDefault` de cada regla (el runtime); `habilitada` por defecto
  sigue siendo el `default` de la hoja del esquema (true). El fantasma inline
  ya implementado se reutiliza.
- **Filas compactas.** Se baja el alto/espaciado de `.ejRegla*`, se reduce el
  padding vertical y el gap, sin perder los controles (switch + severidad).
  Fuente ya en 11px; se mantiene sin `:hover`.
- **Tabs por categoría con conteo** (`React · 30`, `Glory · 17`, …), una lista
  activa a la vez; la cabecera general conserva "X de 105 en config · Y activas".

### Alcance / no alcance
- Sí: extensión del catálogo a 105, tabs por las 8 categorías, filas compactas.
- No: búsqueda por texto (futuro), traducción inventada de nombres (se usan los
  del runtime), cambios al motor de diagnóstico (las reglas siguen siendo el
  `mapaCatalogo` `rules`).

## 3. Fuente canónica y extracción

Se extrae de la versión fijada (NO puede fallar la extracción en el app): el
resultado se copia como **datos estáticos** en `reglas.ts` para que el app no
dependa de que el runtime esté instalado. La extracción se hace una única vez
con `node` contra `ruleRegistry.js` (`obtenerTodasLasReglas()`), que ya hice.

## 4. Cambios concretos

| Archivo | Cambio |
|---|---|
| `src/shared/gate/reglas.ts` | Reemplazar `CATALOGO_REGLAS: string[]` (14) por `REGLAS: ReglaCatalogo[]` (105, con `id/nombre/categoria/severidad`) + `CATEGORIAS_REGLAS: string[]` (8) + `CATALOGO_REGLAS` como derivado `string[]` de ids (compat. con el esquema). |
| `src/v2/EditorEsquema.tsx` | `SeccionReglas`: agrupar por categoría, renderizar tabs (con conteo), mostrar la categoría activa, filas compactas. Los defaults siguen del esquema (fantasma existente). `buscarCatalogo` se mantiene; se pasa `REGLAS`/`CATEGORIAS` desde el componente. |
| `src/v2/paneles/paneles.css` | Estilos de tabs `.ejTabs*` y compactación de `.ejRegla*` (menor padding/gap). |
| `PLAN-reglas-completas-tabs.md` | Este plan; al cerrar se mueve a planes/completados y se registra la tarea. |

## 5. Verificación

- `pnpm type-check`.
- Preview: editor de Glory-Laminal muestra 8 tabs, las 105 reglas repartidas,
  default real inline (fantasma), toggle/severidad insertan en el JSON real,
  filas compactas.
- No dejar modificado el `sentinel.config.json` de Glory-Laminal tras las
  pruebas (git status vacío en ese repo).