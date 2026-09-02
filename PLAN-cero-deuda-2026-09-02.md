# Plan: campaña a CERO — deuda real confirmada (2026-09-02)

> Decisión del usuario (2026-09-02): «La deuda real confirmada, planifícala corregirla toda…
> la meta es llegar a cero». Lo que está en la zona gris/unused se deja PARA EL FINAL y se
> decide **uno por uno** con el usuario en la fase final. Este plan sustituye el frente de
> deuda real de `PLAN-corregir-restantes-sentinel-varsense.md` (§J-11V20 y anteriores).

## 1. Estado de partida (post-V20, runtime V18 publicado / core V20 local)

- **1.001 hallazgos en 9 proyectos, 0 errores**, todos cubiertos por `scripts/quality/excepciones.json` (registro v2) → harness 9/9 MANTENIMIENTO.
- Detector saneado (V17→V20: −380 FPs verificados, 0 FN en auditorías). Lo que queda es deuda **real y categorizada** o decisiones pendientes.
- Reglas de bloque heredadas: FPs se arreglan en el detector (no a mano); sin disables para bajar conteo (salvo decisión explícita en la fase final); visual-neutral; WIP del usuario intacto; auditoría FN old→new en cada cambio de core; scratch `C:/tmp` limpio; commits locales sin push (el push sigue siendo decisión del usuario).

## 2. Inventario por proyecto (conteo medido V21 · naturaleza del registro)

| Proyecto | Total | Familia | Conteo | Naturaleza | Tratamiento |
|---|---|---|---|---|---|
| PROYECTO TASKS | 438 | claseHuerfana | 163 | ≈154 CSS muerta real + ~24 límite scanner + ~4 zona gris (premium/free/trial/expirada) | F2 borrar muertas (con desglose exacto en V22) · zona gris/limite → FASE FINAL |
| | | token-duplicate | 175 | variables.css = WIP del usuario | F5 (gated: cuando el usuario commitee su WIP) |
| | | token-duplicate | 5 | pares cross-dominio/fallback (pixel-editor ×3, ptr ×2) | FASE FINAL |
| | | token-unused | 20 | variables.css = WIP del usuario | F5 (gated) |
| | | cssInlineReact / cssInlineScript | 29 / 32 | runtime dinámico | F4 seams donde existan · resto FASE FINAL |
| | | valorHardcoded | 14 | one-off sin token | F3 re-auditoría exacta · resto FASE FINAL |
| | | variableNoDefinida + menu-contextual | 1 + 3 | WIP del usuario / regla sentinel fuera de scope harness | gated / fuera de scope |
| WANDORIUS | 146 | token-duplicate | 54 | cross-scope inversión de tema oscuro (intencional) | FASE FINAL |
| | | cssInlineScript | 89 | runtime desktop | F4 seams · resto FASE FINAL |
| | | claseHuerfana | 3 | dinámicas (tiptap/ProseMirror DOM librería, movilLauncher__tema factory — límite scanner, vivos) | FASE FINAL (límite scanner) |
| RESTAURANTE | 137 | token-duplicate / token-unused | 49 / 39 | puente @theme Tailwind v4 + aliasing shadcn (generado) | FASE FINAL (decisión por token) |
| | | cssInlineReact | 21 | runtime dinámico | F4 seams · resto FASE FINAL |
| | | valorHardcoded | 15 | one-off canvas (radios/fonts geometría) | F3 re-auditoría · resto FASE FINAL |
| | | claseHuerfana | 6 | dinámicas | F1 re-clasificar |
| | | propiedadProhibida | 7 | no aplicable (schema) | FASE FINAL |
| ONG AGAPE | 78 | valorHardcoded | 69 | one-off sin token | F3 re-auditoría (patrón J-3: 10 exactos) · resto FASE FINAL |
| | | claseHuerfana | 0 | — (V21: submódulos excluidos + FPs imageClass/url corregidos en core) | — |
| | | token-unused / token-duplicate | 4 / 4 | puente generado | FASE FINAL |
| | | cssInlineReact | 1 | runtime datos | FASE FINAL |
| gloryapi | 76 | token-unused / token-duplicate | 38 / 37 | puente @theme + aliasing shadcn | FASE FINAL |
| | | cssInlineReact | 1 | runtime dnd-kit | FASE FINAL |
| workspace-manager | 44 | valorHardcoded | 34 | one-off sin token (auditada V9: 6 reales ya colapsados) | F3 re-auditoría · resto FASE FINAL |
| | | claseHuerfana | 2 | configBadge--sin (borde-analizador, vivo) + mapaV2Etiqueta (MUERTA confirmada V21) | F2 borrar mapaV2Etiqueta (mapaV2.css:104/111) |
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

### F1 (bloque 308A-7V21) — Re-clasificación post-V20 de familias dinámicas — ✅ CERRADO (2026-09-02)
- Objetivo: aplicar la lección de coolify (ch 5→0 con V20) a las familias dinámicas que quedan
  en el registro: AGAPE ch 18, RESTAURANTE ch 6, WANDORIUS ch 6, WM ch 2, Laminal límite 1.
- Método: baseline harness fresco → desglose por archivo/línea → verificar productor dinámico
  real (template `${}`, mapa de sufijos, mapper) → las cubiertas salen del registro; las que no
  tengan productor = muertas reales → F2.
- **Resultado (3 fixes del core varsense, tests 92/92):**
  1. **Walker de submódulos (nodeProviders.ts):** V17 solo excluía `.git` ARCHIVO; AGAPE tenía
     glory-rs/tools con `.git` DIRECTORIO (clon completo) → 12 hallazgos de submódulos
     eliminados (AGAPE ch 18→4).
  2. **Propiedad `imageClass:` (classIndexBuilder.ts):** claves camelCase que terminan en
     Class/clase como carrier (AGAPE AgapeLanding.tsx:20/27/34) → 3 FPs (ch 4→1).
  3. **Artefacto `url(...)`:** la extensión de archivo casaba como clase fantasma (`png` en
     AGAPE, `woff2` en PT @font-face) → neutralizado el segmento url → AGAPE ch 1→0,
     PT ch 164→163.
  4. **RC-4 `.push()` + propiedad-objeto con variable (classIndexBuilder.ts):** `clases.push('x')`
     sobre carriers y `clase: clases.join(' ')` (WANDORIUS notifications-popover.ts:80-83) →
     WANDORIUS ch 6→3.
- **Clasificación final por proyecto:** AGAPE ch 18→**0** (total 96→**78**); RESTAURANTE ch 6
  invariante pero re-verificados vivos línea a línea (estadoMesa() → 'libre'|'ocupada'|'no_show',
  mesa.forma → 'cuadrada'|'redonda'|'rectangular', template PlanoOcupacion.tsx:191 — no
  borrables); WANDORIUS ch 6→**3** (tiptap/ProseMirror DOM de librería + movilLauncher__tema vía
  factory = límite del scanner, vivos); WM ch 2 → configBadge--sin (borde-analizador, vivo) +
  **mapaV2Etiqueta confirmada MUERTA real (0 usos repo-wide; evidencia V13 stale: MapaV2.tsx
  174-175 usa mapaV2ParedDer/ParedIzq/Piso) → lista F2**.
- Verificación: harness **9/9 MANTENIMIENTO, 0 descubiertos, 0 drift** (registro sincronizado:
  AGAPE 78, RESTAURANTE 137, WANDORIUS 146, WM 44, PT 438, resto invariante), 0 errores.
- **Auditoría FN:** PT ch 164→163 (−1 = clase fantasma `woff2` de @font-face, FP del scanner,
  0 FN); WANDORIUS −3 verificados con productor vivo (notificacionesPopover push); AGAPE −18
  verificados (12 submódulos + 4 FPs + 2 dinámicos absorbidos), 0 aparecidos en ningún proyecto.
- **F2 hereda:** mapaV2Etiqueta (WM, mapaV2.css:104/111) como primera muerta confirmada.

### V22 (308A-7V22) — CORREGIR DETECTOR (FPs runtime) ANTES de F2 — ✅ CERRADO (2026-09-02, M1-M5 verdes 53/53, PT 163→151, 0 FNs)

> **Decisión del usuario (2026-09-02):** al presentar la auditoría F2-PT (123 muertas reales +
> 13 VIVAS o FPs del detector + 25-27 zona gris vs las ~154 muertas que el plan esperaba), eligió
> **«Primero corregir detector»**: atacar la raíz (que VarSense no reporte FPs por construcción
> runtime) antes de borrar nada. Este bloque de CORE es previo y bloquea F2.

- **Contexto / estado:** detector V21 limpio en `.quality-tools/varsense` (HEAD `64a25f0`, rama
  `fix/318A-7V2-falsos-positivos`). Incidente "deshacer" resuelto (working tree degradado
  restaurado a HEAD; el dist de las mediciones YA era V21 → baseline 163 claseHuerfana en PT
  verificado con dist reconstruido). Lección → skill `build-artefactos`.
- **Auditoría (subagente solo lectura, 13 ítems / 17 clases):** ninguno es dato externo sin ancla.
  Mecanismos por categoría: B (mapa/literal local) 6 · E+union 5 · D (rango numérico) 3 · C 1 ·
  F (base BEM) 1 · G (literal en template HTML) 1. Ningún mapa usa `as const`.
- **Alcance V22 (4 mecanismos genéricos, SIN type-awareness, reteniendo lo dudoso):**
  1. **[M1] Indexar valores de mapas/objetos literales usados por indirección `MAPA[clave]` en
     contexto de atributo de clase** → absorbe `recordatoriosTexto--pequeno/grande`
     (PanelRecordatorios.tsx:19-21 `CLASES_FUENTE: Record<Tipo,string>` indexado :91). Guard: solo
     en attr className/claseAdicional/`*clase`; solo valores con forma de clase no vacíos.
  2. **[M2] Resolver interpolaciones de templates en DECLARACIONES contra variables locales
     literales (flujo intra-archivo, incluido prefijo pegado)** → absorbe `itemNotificacion--leida`
     (ItemNotificacion.tsx:77 `claseBase='itemNotificacion'` + `\`${claseBase}--leida\``).
  3. **[M3] Literales de `return` en callback local (useMemo/flecha/función) asignado a variable
     usada en className** → absorbe `barraRellenoUrgente/Advertencia/UrgenteCritico/Completado`
     (FilaSubHabito.tsx:51-55 duplica el bloque if localmente; FilaHabito vía hook = límite
     cross-file documentado, pero el duplicado local ya basta para marcar vivas las 4).
  4. **[M4] Clases literal dentro de templates HTML de construcción (`class="..."` en strings
     HTML con `<tag`, p.ej. `html += \`<h${n} class=...\``)** → absorbe
     `scratchpadVistaPreviaTitulo` (base) + `--h4/--h5` (familia pegada `--h`) +
     `scratchpadVistaPreviaChecklist` (useScratchpad.ts:82/94).
  5. **[M5] Fix de `removeComments` con regex literales** (BUG PREEXISTENTE grave que degradaba la
     medición real): removeComments no reconocía regex literales → un regex con comillas/backticks
     (`/[&<>"]/g`, `` /`([^`]+)`/g `` en useScratchpad.ts:28/41) corrompía el estado de strings y
     TODO el texto posterior del archivo quedaba "dentro de string" → los `html +=` con clases
     reales se saltaban por `isCodeMatch`. Era la CAUSA RAÍZ de que M4 no resolviera en PT real
     (el fixture aislado pasaba pero el archivo real no). Fix en dos partes: (1) estado regex en
     removeComments con detección por **whitelist** de `prevSig` (`[=(,:;!?&|[+*%~^{]`) — un
     blacklist era insuficiente (el self-closing JSX `<Tag "x" />` va tras comilla de cierre y
     disparaba un falso regex que se tragaba el archivo: medición PT explotó 156→419, corregido
     con whitelist); (2) neutralizar comillas/backticks internos del regex EN LA SALIDA (emitidas
     como espacio, misma longitud → índices intactos) para que `isInsideString`/`escanear*`
     posteriores no se corrompan.
- **FUERA de V22 (zona gris, retener; se decide en FASE FINAL):** `premium/free/trial/expirada` +
  `noViable` (requieren type-awareness cross-file: expansión de union type; el contrato V18
  documenta `premium` como zona gris reportada con fundamento) y `seccionModerna` (base de familia
  BEM; eximir bases automáticamente arriesga FN; requiere matiz de selector compuesto).
- **Verificación del bloque core:** tests de contrato nuevos por mecanismo + suite completa verde
  (53/53: 48 previos + M1/M2/M3/M4/M5) + lint 0 errores + `check:core` OK + rebuild dist (hash
  `28BB2B87...`) + re-medida PT **163 (V21) → 151 (V22)** = 12 resueltas (las 11 VIVAS esperadas +
  `scratchpadTextoTitulo` destapada por M5 en useScratchpad.ts:54 `class="scratchpadTextoTitulo"`,
  FP real que antes quedaba oculto por la corrupción del regex) + **auditoría FN: 0 NUEVAS**
  (ninguna de las ~123 muertas reales deja de reportarse) + harness 9/9 (por re-ejecutar en el
  commit de cierre). Commit local en la rama `fix/318A-7V2-falsos-positivos` (sin push).
- **Tras V22:** re-clasificar en `excepciones.json` lo absorbido como `fp-dinamico` y proceder a F2
  (borrado de las ~123 muertas con disciplina VAR-3/4).

### F2 (308A-7V22) — Borrado de CSS muerta real confirmada (tras V22)
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