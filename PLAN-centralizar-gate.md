# Plan: centralizar el runtime del gate (Sentinel + VarSense)

> Estado: **propuesto** · Autor: Buffy · Fecha: 2026-08-30 · ID tarea: `308A-1` (reorienta `PLAN-agregar-gate-proyectos.md`)
> Decisión del usuario (2026-08-30): en vez de que cada proyecto tenga su propia copia
> (submódulo o checkout) de Sentinel/VarSense, un **único checkout compartido** fijado por
> commit en `area-trabajo/.quality-tools/`, con todos los consumidores apuntando al **mismo
> commit** vía `sourcePathEnv` (patrón que gloryapi ya usa). Además: **`glory-sentinel` NO
> lleva gate** (sería autorreferencial); la excepción se marca en el workspace-manager solo
> para ese proyecto.

## 1. Objetivo

- Un solo runtime de Sentinel + VarSense para todos los consumidores, sin copias por proyecto.
- Un único commit de Sentinel y un único commit de VarSense usado por todos (`quality:sync` lo valida).
- Eliminar la divergencia actual (Sentinel 0.7.4 en WANDORIUS/RESTAURANTE vs 0.7.5 en gloryapi).
- Completar los consumidores a los que les falta VarSense (Glory-Laminal, gloryapi, ONG AGAPE).
- Marcar `glory-sentinel` como excepción explícita "sin gate" en el workspace-manager, sin
  ocultarlo del mapa y sin que aparezca como problema.

## 2. Estado real actual (verificado 2026-08-30, panel workspace-manager)

| Proyecto | rama primaria | sentinel.config | varsense.config | quality-tools | lock | runtime hoy |
|---|---|---|---|---|---|---|
| Glory-Laminal | `main` | ✅ | ❌ | ❌ | ✅ 0.7.4 (commit null) | shim global |
| gloryapi | `gloryapi` | ✅ | ❌ | ✅ 0.7.5 `643353d` (sourcePath `../glory-sentinel`) | ✅ | checkout externo `../glory-sentinel` |
| PROYECTO TASKS | `main` | ✅ | ✅ | ✅ 0.7.5 `643353d` + varsense `88f281f` | ✅ | sourcePath `../glory-sentinel` + varsense `../RESTAURANTE/tools/varsense`; `.quality-tools` provisionado |
| WANDORIUS | `wandorius` | ✅ | ✅ | ✅ 0.7.4 `0349485` + varsense `88f281f` | ✅ | submódulos `tools/` + `.quality-tools` provisionado |
| RESTAURANTE | `glory-rs-rest` | ✅ | ✅ | ✅ 0.7.4 `0349485` + varsense `88f281f` | ✅ | submódulos `tools/` + `.quality-tools` provisionado |
| TRABAJOS CLIENTES/ONG AGAPE | `ong-agape` | ✅ | ❌ | ❌ | ✅ 0.7.4 (commit null) | submódulos `tools/` (sin provisionar) |

**Sin gate (NO se les instala):** `coolify-manager-rs`, `freebuff-bridge`, `GLORYINSPECTOR`,
`GLORYPORT`, `workspace-manager`. **Excepción explícita:** `glory-sentinel` (el propio repo del
runtime; instalarle gate generaría conflicto autorreferencial).

### Excepciones actuales del panel (7, `data/workspace.config.json`)

```json
{ "version": 2, "ignorados": ["3D/01", "data", "freebuff", "FREEBUFFPROXY",
  "DEEPSEEK-HARNESS", "freebuff-standalone", "freebuff-desktop-patches"], ... }
```

Estas son **ignorados** (ocultos del mapa/lista). `glory-sentinel` NO está en esa lista: hoy
aparece como repo sin gate ("sin sentinel/varsense declarado"), que es justo el problema que
la nueva excepción `sinGate` debe resolver (visible pero sin problema).

### Commits en juego hoy (divergencia a resolver)

- Sentinel: `0349485` (v0.7.4, WANDORIUS/RESTAURANTE) **vs** `643353d` (v0.7.5, gloryapi y
  PROYECTO TASKS).
- VarSense: `88f281f` (v2.2.1) — único commit en uso.
- Checkout local `area-trabajo/glory-sentinel` ya está en `643353d` (tag v0.7.5).

### Coherencia de los que ya tienen gate

La migración **unifica** a todos en el mismo commit y el mismo checkout; cada uno parte de un
estado distinto:

| Proyecto | Hoy | Al terminar |
|---|---|---|
| gloryapi | sentinel 0.7.5 `643353d` vía `sourcePath` `../glory-sentinel`; sin varsense | `sourcePathEnv` compartido + varsense 2.2.1 |
| PROYECTO TASKS | sentinel 0.7.5 `643353d` vía `../glory-sentinel`; varsense 2.2.1 vía `../RESTAURANTE/tools/varsense` (ruta ajena) | `sourcePathEnv` compartido para ambos (se acaba la dependencia del runtime de RESTAURANTE) |
| WANDORIUS | submódulos `tools/sentinel` 0.7.4 + `tools/varsense`; `.quality-tools` local provisionado | `sourcePathEnv` compartido; sentinel 0.7.5 |
| RESTAURANTE | idem WANDORIUS | idem WANDORIUS |
| Glory-Laminal | `sentinel.config` + lock 0.7.4 (commit null); sin `quality-tools` ni varsense | `quality-tools` + `varsense.config` + lock; sentinel 0.7.5 |
| ONG AGAPE | submódulos sin provisionar; sin `quality-tools` ni varsense | `quality-tools` + `varsense.config` + lock; sentinel 0.7.5 |

Todos terminan con el **mismo commit de sentinel (`643353d`)** y el **mismo de varsense
(`88f281f`)**, el mismo checkout compartido y locks regenerados: esa es la coherencia. Lo que
hoy no es coherente (0.7.4 vs 0.7.5, locks con `commit: null`, varsense ausente en 3, y
PROYECTO TASKS dependiendo de `../RESTAURANTE/tools/varsense`) queda resuelto por el plan.

## 3. Diseño

### 3.1 Checkout compartido `area-trabajo/.quality-tools/`

```
area-trabajo/
  .quality-tools/                 # fuera de repos individuales; NO es repo git del área
    sentinel/                     # checkout git limpio, detached en el commit común
    varsense/                     # checkout git limpio, detached en 88f281f
    provision/                    # build/artefactos generados (compilación)
```

- El scanner del workspace-manager ya ignora `.quality-tools` (en `IGNORADAS`), así que no
  aparece como proyecto.
- Es la **única fuente** del runtime; los consumidores no compilan ni provisionan localmente.
- Fuente de clonado: `github.com/1ndoryu/glory-sentinel` y `github.com/1ndoryu/varsense`
  (se puede sembrar desde el checkout local `glory-sentinel` en `643353d`).

### 3.2 Consumidores → `sourcePathEnv` (patrón gloryapi)

Cada consumidor conserva **solo** su `sentinel.config.json`, `varsense.config.json` y
`quality-tools.json`. El `quality-tools.json` pasa a:

```json
{
  "tools": {
    "sentinel": {
      "repository": "https://github.com/1ndoryu/glory-sentinel.git",
      "sourcePathEnv": "GLORY_SENTINEL_SOURCE_PATH",
      "commit": "<COMMUN_SENTINEL>",
      "version": "<V>",
      "...": "resto igual"
    },
    "varsense": {
      "repository": "https://github.com/1ndoryu/varsense.git",
      "sourcePathEnv": "GLORY_VARSENSE_SOURCE_PATH",
      "commit": "88f281f94e6febd02a386b7ed03d30d285eb82e1",
      "version": "2.2.1",
      "...": "resto igual"
    }
  }
}
```

- `GLORY_SENTINEL_SOURCE_PATH` / `GLORY_VARSENSE_SOURCE_PATH` apuntan a
  `C:/Users/Owner/OneDrive/Documentos/area-trabajo/.quality-tools/{sentinel,varsense}`.
- La variable la define el entorno (el server del workspace-manager la deriva de la raíz del
  área); el repo no guarda rutas absolutas.
- **Mismo commit para todos** = todos los `quality-tools.json` declaran el mismo
  `sentinel.commit` y el mismo `varsense.commit`. Si uno difiere, `quality:sync` falla
  (fail-closed) y el lock-check lo detecta.

### 3.3 `quality:sync` (script de bloque)

Script npm en `workspace-manager` que:

1. Recorre los **6 consumidores** (Glory-Laminal, gloryapi, PROYECTO TASKS, WANDORIUS,
   RESTAURANTE, ONG AGAPE).
2. Verifica que cada `quality-tools.json` apunte al checkout compartido y al **commit común**
   (mismo `sentinel.commit` y `varsense.commit` en todos).
3. Regenera `sentinel.lock.json` (y el lock de varsense si aplica) por proyecto con el comando
   oficial (`quality:lock -- --write` o equivalente del proyecto).
4. Falla con mensaje claro si hay desviación (commit distinto, ruta distinta, checkout sucio).
5. Termina con `quality:doctor` + `gate:check` por proyecto (o lo deja listo para ejecutar).

### 3.4 Excepción `glory-sentinel` en el workspace-manager

Nuevo campo en `ConfigWorkspace` (v3): `sinGate: string[]` (claves de proyecto exentas del gate).

- `data/workspace.config.json` → `{ "version": 3, "ignorados": [], "sinGate": ["glory-sentinel"] }`.
- El scanner (`estadoGate`) marca `declarado=false`, `puerta='none'`, `gateDisponible=false`
  para las claves en `sinGate`; no cuentan en `resumen.conGate` ni generan problema "sin gate"
  en la consola. **El proyecto sigue visible** en mapa/lista (a diferencia de `ignorados`, que
  lo oculta).
- UI: en el panel de config > excepciones, una subsección "sin gate" (solo para este caso).
- Se registra **únicamente** `glory-sentinel`; el resto del área no se ve afectado.

## 4. Fases

### F0 — Preflight y versión común (decidida)
- **Decisión (2026-08-30): subir todos a `643353d` (v0.7.5)** — el más nuevo, ya probado en
  gloryapi y el checkout local `area-trabajo/glory-sentinel` ya está ahí. WANDORIUS y
  RESTAURANTE suben desde `0349485` (v0.7.4).
- Verificar que el binario 0.7.5 expone las capacidades actuales (`guard`, `doctor`, `task`,
  `recover`) — las mismas que gloryapi ya declara en su `quality-tools.json`.
- Verificar que las configs `sentinel.config.json` de WANDORIUS/RESTAURANTE (schemaVersion 2,
  0.7.4) siguen válidas en 0.7.5 (doctor sin issues).
- VarSense: `88f281f` (v2.2.1) para todos.

### F1 — Crear checkout compartido
- `git clone`/sembrar `sentinel` (commit común) y `varsense` (`88f281f`) en
  `area-trabajo/.quality-tools/`, detached y limpios.
- Compilar/provisionar una vez; verificar `--version`, `--help` y `doctor` desde el compartido.

### F2 — Migrar WANDORIUS y RESTAURANTE (submódulos → compartido)
- Actualizar `quality-tools.json` a `sourcePathEnv` con el commit común.
- Retirar gitlinks `tools/sentinel` y `tools/varsense` (commit reversible por proyecto).
- Regenerar locks, `quality:doctor`, `gate:check` por proyecto.

### F3 — Migrar gloryapi y PROYECTO TASKS (sourcePath → sourcePathEnv compartido)
- gloryapi: cambiar `sourcePath: "../glory-sentinel"` por `sourcePathEnv`; añadir varsense
  (commit `88f281f`).
- PROYECTO TASKS: cambiar sentinel a `sourcePathEnv` y **varsense de `../RESTAURANTE/tools/varsense`
  a `sourcePathEnv`** (elimina la dependencia del runtime de otro proyecto).
- Regenerar locks, doctor, gate por proyecto.

### F4 — Completar Glory-Laminal y ONG AGAPE
- Crear `quality-tools.json` (sentinel + varsense, compartido).
- Crear `varsense.config.json` (tokens/clases/exclusiones del stack: node para Laminal,
  mixed para ONG AGAPE).
- Regenerar locks, doctor, gate.

### F5 — `quality:sync` + validación de commit común
- Script npm en workspace-manager con el contrato de §3.3.
- Test: desviar un commit en un proyecto → `quality:sync` falla (fail-closed).
- Test: todo alineado → regenera locks y pasa.

### F6 — Excepción `glory-sentinel` en workspace-manager
- Campo `sinGate` en `ConfigWorkspace` (v3) + normalización en `configArea.ts`.
- `estadoGate`/`escanearWorkspace` respetan `sinGate` (visible, sin gate, sin problema).
- UI en `PanelConfig` (subsección "sin gate") + endpoint de toggle (solo permite marcar la
  clave real `glory-sentinel`).
- Registrar `glory-sentinel` en `data/workspace.config.json`.

### F7 — Verificación final en el panel
- Escaneo completo: los **6 consumidores** (Glory-Laminal, gloryapi, PROYECTO TASKS,
  WANDORIUS, RESTAURANTE, ONG AGAPE) con gate declarado y puerta `sentinel`, sin problemas
  de varsense ausente.
- `glory-sentinel` visible con "gate: no (excepción)" y sin problema en consola.
- Último `gate:check` PASS por proyecto (reporte en `.quality-reports/` de cada uno).

## 5. Definition of Done

- [ ] Un único checkout compartido `area-trabajo/.quality-tools/` con Sentinel y VarSense.
- [ ] Los **6 consumidores** apuntan al checkout compartido con el **mismo commit** de Sentinel y
      el mismo de VarSense (validado por `quality:sync`).
- [ ] `quality:sync` regenera locks en bloque y falla cerrado ante desviación.
- [ ] `glory-sentinel` marcado como excepción "sin gate" en el workspace-manager (solo él);
      visible en el panel y sin problemas.
- [ ] Doctor OK y último `gate:check` PASS por consumidor (o limitación registrada con evidencia).
- [ ] Los repos sin gate (coolify-manager-rs, freebuff-bridge, GLORYINSPECTOR, GLORYPORT,
      workspace-manager) NO se tocan.
- [ ] Commits por proyecto en sus repos; plan cerrado y registrado en completados.

## 6. Pendientes / decisiones abiertas

1. ~~**Versión común de Sentinel**~~ — **RESUELTO (2026-08-30): subir todos a `643353d` (v0.7.5)**.
2. **Dónde vive la env var** para el CLI de los consumidores (por máquina): definir en el
   entorno de usuario o derivarla el server del workspace-manager.
3. **`quality:sync`**: como script npm de workspace-manager (recomendado) o script suelto del área.
4. **`.quality-tools` local** de WANDORIUS/RESTAURANTE/PROYECTO TASKS: retirar (única fuente =
   compartido, recomendado) o dejar como caché por proyecto.
5. **PROYECTO TASKS**: su `sourcePath` de varsense apunta a `../RESTAURANTE/tools/varsense`
   (dependencia entre proyectos). Al migrar a `sourcePathEnv` compartido se elimina; confirmar
   que su script `quality:setup`/`quality:lock` no referencia rutas relativas por otro lado.

## 7. Seguimiento

- Orden F0→F7; cada fase cierra con verificación (type-check/gate/doctor) y commit en el repo
  correspondiente.
- Tarea en el roadmap de `workspace-manager` (`308A-1`); coordina con los roadmaps de cada
  consumidor.
- Reemplaza la dirección de `PLAN-agregar-gate-proyectos.md` (que proponía instalar gate desde
  cero en coolify-manager-rs/GLORYPORT/workspace-manager — **descartado**: no llevan gate).

## Seguimiento 2026-08-30 (sesión 308A-1)

- **F0/F1 ✅** — Checkout compartido creado en `area-trabajo/.quality-tools/`: `sentinel`
  (detached `643353d`, v0.7.5, limpio) y `varsense` (detached `88f281f`, limpio) sembrados desde
  las fuentes locales ya verificadas. `.quality-tools` ya consta en `IGNORADAS` del scanner.
  El «mismo commit para todos» se valida comparando `dist/index.ts` (binario real) entre versiones,
  no solo el hash de git.
- **F6 ✅** — Excepción `sinGate` en workspace-manager: campo `sinGate: string[]` en
  `ConfigWorkspace` (v3), normalización en `configArea.ts`, respeto en el scanner (`puerta`
  forzada a `'none'`, `gateDisponible: false`, sigue visible en mapa), endpoint
  `POST /api/config/singate` (solo acepta la clave real `glory-sentinel`), acción
  `cambiarSinGate` en el store y subsección «sin gate» en el PanelConfig. Registrado
  `glory-sentinel` en `data/workspace.config.json` (ignorado por git → artefacto runtime).
  Verificado end-to-end: toggle eximir/quitar devuelve 200 y persiste; escaneo real fuerza
  `puerta:none` para `glory-sentinel` mientras los 6 consumidores con gate (Glory-Laminal,
  gloryapi, ONG AGAPE, PROYECTO TASKS, RESTAURANTE, WANDORIUS) siguen `declarado:true`.
- **S2-05 RESUELTO / provisionado (2026-08-30)** — El supuesto «VarSense sin runtime oficial
  verificable» era **stale**: `RESTAURANTE/tools/varsense` ya tenía runtime reproducible
  (v2.2.1, `dist/cli/index.js`, `npm run compile` exit 0). Provisioné al completo el checkout
  compartido: en `area-trabajo/.quality-tools/sentinel` (detached `643353d` v0.7.5) ejecuté
  `npm install` + `npm run compile` y `node out/cli/index.js --version` responde `0.7.5`; en
  `area-trabajo/.quality-tools/varsense` (detached `88f281f` v2.2.1) `npm install` + `npm run
  compile` y `node dist/cli/index.js --version` responde `2.2.1`. Locks restaurados, árboles
  detached/limpios, `.quality-tools` sigue en `IGNORADAS`.
- **F5 ✅ (2026-08-30)** — `scripts/quality-sync.mjs` + registro npm `sync:quality` (commit `64c4ee5`):
  validación en-repo fail-closed que compara `sentinel.commit`/`varsense.commit` de cada
  `quality-tools.json` contra el HEAD del checkout compartido, verifica que la ruta de la tool
  apunte al compartido y que el checkout esté limpio; exit 1 claro ante cualquier desviación y
  con `--json` para CI. Corrida real: exit 1 `problemas: 2` (WANDORIUS y RESTAURANTE desync
  0.7.4 `0349485` vs compartido 0.7.5 `643353d` — el paso pendiente de F2); gloryapi/PT ya
  alineados; Glory-Laminal/ONG AGAPE aún sin `quality-tools` (pendiente F4).
- **Derivación de env en el server (2026-08-30)** — `src/server/gate/analizador.ts` (commit
  `2ae5f10`): `entornoGate()` deriva `GLORY_SENTINEL_SOURCE_PATH` y `GLORY_VARSENSE_SOURCE_PATH`
  desde `RAÍZ_AREA/.quality-tools/{sentinel,varsense}` en el punto exacto donde el server lanza
  sentinel por proyecto (`correrSentinel`), sin pisar overrides del usuario (solo si la env no
  viene definida) y sin filtrarse a otras herramientas. Cubre las invocaciones `analyze` del
  manager; no la env global que usaría el `gate:check`/`doctor` **manual** del desarrollador.
- **F2 ✅ parcial / F3 ✅ COMPLETO (2026-08-30)** — Mecanismo final elegido y probado: en vez
  de depender de la env global del host (Opción A cruda) ni de correr todo vía el manager
  (Opción B), se usa el **relative `sourcePath` + `provisionPath` a `../.quality-tools/`**
  (resuelto contra baseDir por el frame, portable entre máquinas, **sin OS env**). Esto es
  efectivamente la «Opción A gestionada»: una única fuente de verdad (el checkout compartido)
  sin configuración manual por máquina.
  - **gloryapi (piloto)** ✅ — `sourcePathEnEnv`_
  _dejado atrás_; `quality-tools.json` con `sourcePath`+`provisionPath` `../.quality-tools/sentinel`
  @`643353d` v0.7.5. Doctor PASS (`readyForGate:true`, `issues:[]`, policy enforce) con `GLORY_*`
  vacía. Commit `e0981cd`.
  - **PROYECTO TASKS** ✅ — sentinel `../.quality-tools/sentinel` @`643353d` + varsense
    `../.quality-tools/varsense` @`88f281f`; doctor PASS (`readyForGate:true`, issues vacío,
    policy enforce) con env vacía. Commit `ef65283`.
  - **RESTAURANTE** ✅ — sentinel+varsense `../.quality-tools/` full hash `643353d7e968…`
    (`quality:sync` requiere hash completo); doctor del frame verde (status `policy`, `blocked:false`)
    contra el build compartido. Commit `2f53e39a`.
  - `quality:sync` tras F3+RESTAURANTE: **`problemas: 1`** (solo WANDORIUS desync); gloryapi/PT/RESTAURANTE
    `alineado`.
- **F2 WANDORIUS ⏸ BLOQUEADO con evidencia (2026-08-30)** — Su frame bespoke **no usa
  `provisionPath`** (a diferencia de RESTAURANTE), lleva su propio lifecycle de install/lock
  (`.quality-tools/install-state.json` reliquia 0.4.0), y al repuntar `sourcePath` al compartido
  el `doctor` exige **`npm run quality:setup`** (recompila/regenera lock en el commit nuevo) y
  reporta 5 issues (`tool-release-evidence-missing`, `checkout-mismatch`, `lock-mismatch`,
  `lock-version-mismatch`, `installed-mismatch`). Migrarlo por la fuerza arrastraría un rebuild
  completo + regeneración amplia de locks — riesgo que la disciplina del hilo no permite forzar.
  Se **revirtió al estado verificado 0.7.4** (`tools/sentinel`, árbol limpio, doctor green,
  `readyForGate:true`, issues 0). Queda documentado como pendiente que requiere o bien un
  `quality:setup` dirigido a su vida (decisión explícita) o armonizar su frame bespoke con el
  patrón `provisionPath` (cambio de más alcance).
- **F4 Glory-Laminal / ONG AGAPE ✅ REGISTRO (2026-08-30)**: creados `quality-tools.json`
  (sentinel `../.quality-tools/sentinel` @`643353d7e968…` v0.7.5 + varsense `../.quality-tools/varsense`
  @`88f281f…` v2.2.1, full hash) y `varsense.config.json` (stack token) sobre el compartido,
  siguiendo el patrón gloryapi/PT. `quality:sync` tras el registro: **Glory-Laminal `sentinel=ok
  varsense=ok ✓`**, **ONG AGAPE `sentinel=ok varsense=ok ✓`** — `problemas: 1` (solo WANDORIUS).
  JSON parsean y los commits declarados coinciden con los HEAD del checkout compartido.
  **BOOTSTRAP F4 ✅ (2026-08-31)**: portada la maquinaria minimal de provisión (la misma que usan
  los consumidores migrados) a ambos repos, y queda el `doctor` del shim en **`readyForGate:true`**
  con issues `[]` y `quality:sync` alineado (sentinel+varsense ✓; `problemas: 1`, solo WANDORIUS):
    - **Glory-Laminal** commit `edbd1e7`: `scripts/quality/quality-setup.mjs` (evidencia release
      real: compila + suite contra el compartido, 559 tests de sentinel + smoke de varsense) +
      `scripts/quality/lock-generator.mjs` (regenera `sentinel.lock.json` con backup, commit/
      sha256 reales) + scripts npm `quality:setup`/`quality:lock`. Evidencia gitignored (por
      máquina); lock 0.7.5/`643353d` + varsense 2.2.1/`88f281f`.
    - **ONG AGAPE** commit `896a864`: mismo port, **corrigiendo las rutas del compartido a
      `../../.quality-tools/`** (el repro estaba un nivel más por `TRABAJOS CLIENTES/`) y
      re-incluyendo `scripts/quality/` en la whitelist del `.gitignore` (otra causa).
- **Pendiente F7** — verificación final en el panel (los consumidores migrados sobre el
  compartido + `glory-sentinel` exento) tras resolver F2-WANDORIUS y `308A-2` (VarSense).
  El bootstrap de GL/ONG ya no es pendiente.
