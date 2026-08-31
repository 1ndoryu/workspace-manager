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
