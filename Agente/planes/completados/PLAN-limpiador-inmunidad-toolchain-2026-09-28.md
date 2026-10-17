# PLAN-limpiador-inmunidad-toolchain-2026-09-28.md

> Estado: **activo** · Fecha: 2026-09-28 · ID tarea: `289A-5`
> Pedido del usuario: «el limpiador al limpiar hace que la detección de problemas de sentinel en workspace manager deje de funcionar, debería arreglarse automáticamente eso al escanear».

## 1. Causa con evidencia (2026-09-28, solo lectura)

- El área clasifica **cualquier** carpeta `node_modules|target|dist` bajo la raíz (`scan.rs:141`), sin excepciones de tooling.
- El checkout compartido `area-trabajo/.quality-tools/sentinel` conserva `out/` (ignorado por git, o sea: se compiló en local ⇒ `node_modules` existió) pero **ya no tiene `node_modules`**; varsense perdió `node_modules` **y** `dist/`. `out/` sobrevivió porque `out` no es categoría; `dist` sí lo es. Patrón exacto de un `area-clean` sobre `.quality-tools`.
- Daño actual (doctor WM): `tool-cli-unresponsive` + `tool-dependencies-missing` (sentinel y varsense) + `tool-cli-missing` (varsense `dist/cli/index.js`) + 4 `tool-capability-missing`. El gate no detecta nada.
- Misma clase de riesgo: `.sentinel/worktrees/*/node_modules` (worktrees con deps instaladas; los gestiona `sentinel task cleanup`, no el limpiador).

## 2. Diseño (automático en cada scan, sin flags)

- **A. Inmunidad por poda** (`seguridad.rs` + `scan.rs`): `PROTEGIDAS = [".quality-tools", ".sentinel"]`; `bajo_protegida(rel)` (cualquier ancestro). El paseo no desciende ni clasifica dentro: esas rutas dejan de existir para el reporte.
- **B. Aviso auto-reparación** (`scan.rs`): al encontrar `.quality-tools`, inspección de un nivel `<herr>/`: si hay `package.json` sin `node_modules` ⇒ entrada `{tipo:"aviso", bytes:0, motivo:<comando oficial>}`. No reinstala (un scan es solo lectura; reinstalar exige red): lo automático es detectar + guiar en cada escaneo. `clean` la rechaza siempre (la hoja no es categoría ⇒ `verificar_borrado` la deniega aunque se seleccione a mano).
- **C. Rechazo en clean** (`verificar_borrado`): deniega rutas bajo protegidas aunque vengan de un reporte viejo escrito a mano. Defensa en profundidad; el resto de fases usan objetivos fijos y no tocan estas rutas.
- No se generaliza a "todos los dot-dirs": ocultaría peso real. Solo tooling con dueño (`quality-tools.json` / `sentinel task`).

## 3. Límites honestos

- El scan no puede devolver `node_modules` borrados: la re-provisión real es `npm run quality:setup` (proyecto) o `npm install` en el checkout. El aviso lo dice en cada scan hasta que se repare.
- Código 289A-5 sin compilar: mismo bloqueo F1d (shim cargo + gate sin bootstrap). Verificación (`fmt`+`clippy`+`test` con los tests nuevos de poda/aviso/rechazo) pendiente de la receta de terminal del usuario.

## 4. DoD

- Fixture: `.quality-tools/herr` rota ⇒ 1 aviso + 0 limpiables; `.quality-tools/ok` instalada ⇒ 0/0; `.sentinel/worktrees/w/node_modules` ⇒ 0 entradas; `p/node_modules` normal sigue reportándose; `verificar_borrado` rechaza ruta protegida alimentada a mano.
- Doctor WM vuelve a `readyForGate:true` tras la re-provisión; roadmap actualizado; commits `289A-4` + `289A-5` sin push.

## 5. Cierre (2026-09-28, 289A-5 HECHO)

- **Gate `sentinel check 289A-5` PASS** (fmt/clippy/test, 0/0/0; 23 tests). Doctor y onboarding en §6 del plan 289A-4.
- **F3 en vivo cazó un hueco (inmunidad relativa → absoluta).** `scan --raiz .quality-tools` ofrecía sus `node_modules`/`dist` porque el prefijo común recorta el componente protegido. Fix: poda por componentes absolutos en el paseo + aviso cuando la raíz ES tooling + `verificar_borrado` rechaza por componente absoluto aunque la raíz apunte dentro (defensa en profundidad del clean). 2 tests nuevos (`raiz_directa_en_herramientas_no_ofrece_nada`, `clean_rechaza_tooling_aunque_la_raiz_apunte_dentro`); segundo gate PASS tras el fix.
- **En vivo con 0.5.0:** `--raiz .quality-tools` → 1 aviso, 0 bytes. Scan del área: 10 entradas · 2.48 GB, 5 bajo tooling y las 5 `tipo:aviso` (provisiones locales rotas en WANDORIUS ×2, RESTAURANTE ×2, PROYECTO TASKS ×1: tienen `package.json` sin `node_modules` en su `.quality-tools` propio; fuera de alcance, cada proyecto lo repara con su `quality:setup`). Tooling sano (checkout compartido reprovisionado) invisible. Basura normal sigue reportándose.
