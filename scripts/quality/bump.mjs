/* quality:bump — propaga un release de herramienta a TODOS los consumidores.
 *
 * [por que] El invariante "un commit común para todos" ya estaba guardado
 * (`quality-sync.mjs`), pero no existía el ESCRITOR: publicar Sentinel 0.7.9
 * exigió editar 11 `quality-tools.json` a mano, y la propagación se hacía con un
 * script suelto en una ruta temporal que el barrido de `C:\tmp` puede borrar
 * (109A-9). Este script es la herramienta única: reescribe el pin, regenera el
 * lock, produce la evidencia (con la caché de certificación, ver
 * `certificacion.mjs`) y verifica con el doctor de cada consumidor.
 *
 * La lista de consumidores NO se duplica aquí: se toma del propio guard
 * (`quality-sync.mjs --json`), que ya es su fuente de verdad. Así el conjunto que
 * propaga y el que verifica no pueden divergir.
 *
 * Es DRY-RUN por defecto (coherente con `lock-generator.mjs`): sin `--write` no
 * toca nada. Idempotente: sobre un estado ya propagado no produce cambios.
 *
 * Uso:
 *   node scripts/quality/bump.mjs --tool sentinel                     (dry-run)
 *   node scripts/quality/bump.mjs --tool sentinel --write
 *   node scripts/quality/bump.mjs --shims [--write]
 * Opciones:
 *   --tool <nombre>       herramienta a propagar (sentinel|varsense)
 *   --commit <sha>        commit destino (por defecto el HEAD del checkout)
 *   --version <v>         versión destino (por defecto la del package.json)
 *   --source <dir>        checkout desde el que se deriva el destino
 *                         (por defecto <área>/.quality-tools/<tool>)
 *   --only a,b / --skip a,b   restringe los consumidores
 *   --shims               revisa (y con --write reescribe) los routers del adapter
 *   --no-steps            solo reescribe manifiestos/routers, sin lock/setup/doctor
 *   --json                salida legible por máquina
 *
 * Rutas y familias: A = checkout compartido (el adapter es un router al canónico);
 * B = submódulo versionado dentro del consumidor (tiene su propio adapter y su
 * lock exige el gitlink commiteado en el padre). Los routers solo se propagan a
 * la familia A; un adapter propio nunca se pisa.
 *
 * El cuerpo vivia en un solo archivo de 460 lineas efectivas (limite 300). Se
 * partio por dominio en scripts/quality/bump/ y este archivo quedo como barril:
 * la ruta `node scripts/quality/bump.mjs` no cambia.
 *
 *   ajustes.mjs       rutas base, routers y flags de argv
 *   utilidades.mjs    citar, ejecutar y leer JSON tolerante
 *   router.mjs        texto canonico del router que se propaga
 *   manifiesto.mjs    escritura del pin sin reserializar quality-tools.json
 *   consumidores.mjs  quien consume, su familia y el estado de sus routers
 *   release.mjs       que release se propaga y con que comandos se rehace
 *   propagacion.mjs   propagar a un consumidor: pin, lock, evidencia y doctor
 *   informe.mjs       tabla de resultados
 *   cli.mjs           main()
 */
import { main } from './bump/cli.mjs';

export { main } from './bump/cli.mjs';

main();
