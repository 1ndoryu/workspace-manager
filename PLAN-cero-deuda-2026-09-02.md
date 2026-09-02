# Plan: campaña a CERO — deuda real confirmada (2026-09-02)

> Decisión del usuario (2026-09-02): «La deuda real confirmada, planifícala corregirla toda…
> la meta es llegar a cero». Lo que está en la zona gris/unused se deja PARA EL FINAL y se
> decide **uno por uno** con el usuario en la fase final. Este plan sustituye el frente de
> deuda real de `PLAN-corregir-restantes-sentinel-varsense.md` (§J-11V20 y anteriores).

## 1. Estado de partida (post-V20, runtime V18 publicado / core V20 local)

- **1.001 hallazgos en 9 proyectos, 0 errores**, todos cubiertos por `scripts/quality/excepciones.json` (registro v2) → harness 9/9 MANTENIMIENTO.
- Detector saneado (V17→V20: −380 FPs verificados, 0 FN en auditorías). Lo que queda es deuda **real y categorizada** o decisiones pendientes.
- Reglas de bloque heredadas: FPs se arreglan en el detector (no a mano); sin disables para bajar conteo (salvo decisión explícita en la fase final); visual-neutral; WIP del usuario intacto; auditoría FN old→new en cada cambio de core; scratch `C:/tmp` limpio; commits locales sin push (el push sigue siendo decisión del usuario).

## 2. Inventario por proyecto (conteo medido V20 · naturaleza del registro)

| Proyecto | Total | Familia | Conteo | Naturaleza | Tratamiento |
|---|---|---|---|---|---|
| PROYECTO TASKS | 439 | claseHuerfana | 164 | ≈154 CSS muerta real + ~24 límite scanner + ~4 zona gris (premium/free/trial/expirada) | F2 borrar muertas (con desglose exacto en V21) · zona gris/limite → FASE FINAL |
| | | token-duplicate | 175 | variables.css = WIP del usuario | F5 (gated: cuando el usuario commitee su WIP) |
| | | token-duplicate | 5 | pares cross-dominio/fallback (pixel-editor ×3, ptr ×2) | FASE FINAL |
| | | token-unused | 20 | variables.css = WIP del usuario | F5 (gated) |
| | | cssInlineReact / cssInlineScript | 29 / 32 | runtime dinámico | F4 seams donde existan · resto FASE FINAL |
| | | valorHardcoded | 14 | one-off sin token | F3 re-auditoría exacta · resto FASE FINAL |
| | | variableNoDefinida + menu-contextual | 1 + 3 | WIP del usuario / regla sentinel fuera de scope harness | gated / fuera de scope |
| WANDORIUS | 149 | token-duplicate | 54 | cross-scope inversión de tema oscuro (intencional) | FASE FINAL |
| | | cssInlineScript | 89 | runtime desktop | F4 seams · resto FASE FINAL |
| | | claseHuerfana | 6 | dinámicas (tag-estado--${status}, Tiptap DOM) | F1 re-clasificar con V20 (patrón coolify 5→0) |
| RESTAURANTE | 137 | token-duplicate / token-unused | 49 / 39 | puente @theme Tailwind v4 + aliasing shadcn (generado) | FASE FINAL (decisión por token) |
| | | cssInlineReact | 21 | runtime dinámico | F4 seams · resto FASE FINAL |
| | | valorHardcoded | 15 | one-off canvas (radios/fonts geometría) | F3 re-auditoría · resto FASE FINAL |
| | | claseHuerfana | 6 | dinámicas | F1 re-clasificar |
| | | propiedadProhibida | 7 | no aplicable (schema) | FASE FINAL |
| ONG AGAPE | 96 | valorHardcoded | 69 | one-off sin token | F3 re-auditoría (patrón J-3: 10 exactos) · resto FASE FINAL |
| | | claseHuerfana | 18 | dinámicas (tarjetaAgape--${tono}, toast--${tipo}…) | F1 re-clasificar (patrón coolify) |
| | | token-unused / token-duplicate | 4 / 4 | puente generado | FASE FINAL |
| | | cssInlineReact | 1 | runtime datos | FASE FINAL |
| gloryapi | 76 | token-unused / token-duplicate | 38 / 37 | puente @theme + aliasing shadcn | FASE FINAL |
| | | cssInlineReact | 1 | runtime dnd-kit | FASE FINAL |
| workspace-manager | 44 | valorHardcoded | 34 | one-off sin token (auditada V9: 6 reales ya colapsados) | F3 re-auditoría · resto FASE FINAL |
| | | claseHuerfana | 2 | par borde-analizador (reales) | F2 borrar si 0-uso confirmado |
| | | cruce-dominio / runtime-posicion / monolito | 4 / 4 / 1 | intencionales / runtime / monolito | FASE FINAL |
| Glory-Laminal | 42 | token-unused | 14 | API pública del tema (consumo externo) | FASE FINAL |
| | | cssInlineScript | 23 | runtime editor | F4 seams · resto FASE FINAL |
| | | valorHardcoded / claseHuerfana | 4 / 1 | one-off gizmo/canvas / límite analizador | F3 / FASE FINAL |
| coolify-manager-rs | 18 | valorHardcoded | 11 | one-off portal VPS | F3 re-auditoría · resto FASE FINAL |
| | | token-duplicate | 6 | cross-dominio monocromo (colapsar acoplaría dominios) | FASE FINAL |
| | | cssInlineReact | 1 | runtime menú | FASE FINAL |
| GLORYPORT | 0 | — | — | — | — |

**Lectura honesta del inventario:** de los 1.001, la parte **corregible sin decisión** es acotada
(clases muertas + colapsos exactos + seams reales + WIP de tokens cuando aterrice); el grueso
(~700) es deuda clasificada cuya resolución es una **decisión por ítem** (fase final): crear
token canónico, colapsar (aunque acople dominios), aceptar con disable justificado, o mantener
registrado como excepción permanente. El plan baja el número sin decisiones y termina con la
ronda final uno-a-uno hasta 0.

## 3. Fases de ejecución

### F1 (bloque 308A-7V21) — Re-clasificación post-V20 de familias dinámicas
- Objetivo: aplicar la lección de coolify (ch 5→0 con V20) a las familias dinámicas que quedan
  en el registro: AGAPE ch 18, RESTAURANTE ch 6, WANDORIUS ch 6, WM ch 2, Laminal límite 1.
- Método: baseline harness fresco → desglose por archivo/línea → verificar productor dinámico
  real (template `${}`, mapa de sufijos, mapper) → las cubiertas salen del registro; las que no
  tengan productor = muertas reales → F2.
- Verificación: harness 9/9, 0 descubiertos, 0 drift (registro sincronizado), 0 errores.
- Esperado: ch del área ~28 → ~2 (solo muertas reales pendientes de borrar).

### F2 (308A-7V22) — Borrado de CSS muerta real confirmada
- Objetivo: cero `claseHuerfana` real en el área. PT ~154 (desglose exacto en V21: el detector
  ya separó lo dinámico; queda verificar 0-uso de cada clase) + WM par borde-analizador + lo que
  F1 declare muerto.
- Método (disciplina VAR-3/VAR-4, regla PT §4): confirmación repo-wide por clase (ts/tsx/js/jsx/
  html/php/rs, palabra completa, template literals, prefijos BEM/`--`, mapas de sufijos; el CSS
  propio NO cuenta como uso); borrado con `str_replace` exacto (sin scripts mutadores);
  colapso de líneas en blanco residuales; si el archivo queda vacío, borrar archivo y su
  `@import`; **side-effect de tokens**: si borrar deja un token sin consumidor en variables.css
  (WIP del usuario), no tocarlo y documentarlo honestamente.
- Verificación por repo tocado: balance de llaves CSS, type-check + build del stack propio,
  varsense sin hallazgos nuevos, sentinel sin regresión (0 errores), harness 9/9.
- Esperado: PT 439 → ~275 (quedan 164−154 = ~10 entre límite scanner y zona gris, pasan a fase
  final); WM 44 → 42.

### F3 (308A-7V23) — Re-auditoría `valorHardcoded` con token exacto
- Objetivo: cazar los subconjuntos reales con match exacto de token existente (patrón V5/V9/J-3:
  PT −3, WM −6, AGAPE −10).
- Alcance: AGAPE 69, coolify 11, WM 34, REST 15, Laminal 4, PT 14.
- Método: por archivo, valor literal vs tokens declarados en el mismo `:root`/tema; sustitución
  SOLO con match exacto y visual-neutral; el resto (one-off sin token honesto) pasa a la fase
  final con su línea como evidencia.
- Verificación: type-check/build, varsense 0 errores sin hallazgos nuevos, sentinel sin
  regresión, harness 9/9.
- Esperado (estimación conservadora): −15..−25 en el área.

### F4 (308A-7V24) — Seams reales de CSS runtime
- Objetivo: resolver lo que tiene seam estático sin cambiar comportamiento:
  - `body.overflow`/`userSelect`/`cursor` durante modal/drag (patrón enmarcado en V6: clase
    `body.modalAbierto` en CSS + toggles en los hooks; requiere prueba de interacción real).
  - Estilos geométricos que sí puedan expresarse como custom property estática.
- Regla: solo lo probable con interacción real; lo puramente imperativo (coordenadas
  getBoundingClientRect, progresos %) pasa a la fase final con evidencia línea a línea.
- Verificación: prueba funcional real de los flujos tocados (modal, drag, resize) + type-check/
  build + varsense/sentinel/harness.

### F5 (308A-7V25) — Tokens del WIP de PT (gated)
- Precondición: el usuario commitea su WIP de `variables.css` (175 token-duplicate + 20
  token-unused + 1 variableNoDefinida). Hasta entonces NO se toca ese archivo.
- Cuando aterrice: colapsos same-scope (patrón V15: 5 pares ya resueltos; los 175 son pares
  reales same-file) y unused removidos o excepcionados con evidencia; los pares cross-dominio
  que aparezcan pasan a la fase final.

### FASE FINAL (308A-7V26+) — Zona gris/unused: decisión uno a uno
- Lista numerada de ítems a decidir con el usuario (cada uno con archivo/línea/evidencia del
  registro). Categorías:
  1. **Zona gris PT** (~4): premium/free/trial/expirada/noViable — valores de estado runtime que
     alimentan clases vía `detallePlan ${plan}`; opciones: conservar registrado, crear sufijo
     estático por estado, o disable justificado.
  2. **Límite real del scanner** (~24 PT + 1 Laminal): mapas de sufijos cross-file indecidibles;
     opciones: resolver a mano uno a uno, ampliar el indexador (bloque core nuevo), o registrar
     permanente.
  3. **Puente generado Tailwind/shadcn** (REST 88, gloryapi 75, AGAPE 8): unused "usados pero
     invisibles" + aliasing intencional; opciones: ignorar por configuración del scanner (scope
     @theme), auditar por par, o registrar permanente.
  4. **Cross-scope/cross-dominio intencionales** (WANDORIUS 54 tema oscuro, coolify 6, WM 4,
     PT 5): colapsar acoplaría dominios; opciones: aceptar permanente (recomendado), colapsar
     los que el usuario considere acoplables, o disable.
  5. **One-offs sin token honesto** (~150-200): opciones: crear token canónico cuando haya 2+
     consumidores reales, aceptar permanente con registro, o disable.
  6. **Runtime sin seam** (~180: cssInlineScript/React desktop y editor): opciones: aceptar
     permanente (recomendado), o disable con justificación.
  7. **Monolitos/no-aplicables** (WM monolito, REST propiedadProhibida): aceptar permanente.
- Cada decisión se registra en `excepciones.json` con categoría + evidencia, y el harness pasa a
  verificar el **estado decidido** como cobertura. **Meta: 0 hallazgos sin decisión.**
- Cierre de la campaña: tabla final por proyecto = 0 pendientes, resumen consolidado en el plan
  y completados, y el harness como guarda permanente (0 descubiertos/0 drift).

## 4. Verificación transversal (cada fase)

- Harness 9/9: MANTENIMIENTO, 0 descubiertos, 0 drift (registro sincronizado en la misma fase).
- varsense: 0 errores, sin hallazgos nuevos fuera del registro.
- Sentinel: 0 errores, sin hallazgos nuevos en archivos tocados (pinned 0.7.7 `0559576`).
- type-check + build del stack de cada repo tocado.
- WIP del usuario intacto y sin stage (PT: variables.css, data/, test_prueba.md).
- Auditoría FN old→new solo si se toca core (F1 puede requerirlo si aflora un gap del detector —
  entonces bloque core con tests + 88/88 + lint + check:core).
- Commits locales por repo, stage explícito, SIN push (decisión del usuario, junto con publicar
  el core V20 y re-alinear el runtime 8787).
- Scratch `C:/tmp` limpio al cierre de cada bloque.

## 5. Definición de cierre (DoD de la campaña)

1. Todas las clases muertas confirmadas borradas (F2) y todas las familias dinámicas re-clasificadas (F1).
2. Todos los `valorHardcoded` con token exacto colapsados (F3); el resto en la lista final.
3. Seams de runtime probados y aplicados (F4); el resto en la lista final.
4. WIP de PT procesado cuando el usuario lo commitee (F5).
5. **Fase final: cada ítem de la lista decidido y registrado** → total del área = 0 pendientes
   sin decisión; harness 9/9 verde con el registro decidido como única cobertura.
6. Docs únicas actualizadas: este plan como fuente, roadmap con entrada de cierre, completados
   con evidencia por bloque.

## 6. Riesgos y reglas inviolables

- No tocar generados Tailwind/shadcn (`@theme`), glory-rs (submódulo), ni `variables.css` antes de F5.
- No borrar con verificador automático solo: inspección manual + búsqueda repo-wide por clase.
- Ante duda, RETENER (regla VAR-3) y pasar a la lista final en vez de arriesgar una FN.
- No inventar tokens: sustituir solo con match exacto (lección V5: sin segundo consumidor real,
  no se fuerza).
- El runtime del server 8787 sigue en dist V18 hasta la decisión de re-alineación (fuera de esta
  campaña; se documenta en el cierre).