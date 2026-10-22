/* Alta de un proyecto (10AA-2 F10). Por defecto solo comprueba; `--aplicar` crea lo
 * que falta en una rama del proyecto. Lista canónica: Agente/documentacion/alta-proyectos-2026-10-11.md.
 *   alta <id|carpeta> [--aplicar]
 * [por que] El alta estaba repartida entre dos skills y nadie comprobaba que quedara
 * completa. Aquí la lista vive en código; el documento explica el porqué de cada punto.
 * Lo que requiere decisión (Sentinel, varsense, target-dir de Rust, registro en el mando)
 * nunca se crea solo: solo se marca ✗ con la acción. */
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { RAIZ } from '../gate.mjs';
import { rutaConfigPrivada } from '../../../shared/rutas.mjs';
import { comprobarAlta } from './altaComprobaciones.mjs';
import { aplicarAlta } from './altaAplicar.mjs';
import { norma } from './altaReglas.mjs';

// Reexports: la API publica no cambia (otros modulos importan estas funciones desde alta.mjs).
export {
  comprobarStack, comprobarGit, comprobarReadme, comprobarRoadmapAgente, comprobarQualityCheck,
  comprobarSentinel, comprobarVarsense, comprobarCargo, comprobarGitignore, comprobarSinAgentsPropios,
  comprobarAlta,
} from './altaComprobaciones.mjs';
export { comprobarRegistro } from './altaReglas.mjs';
export { aplicarAlta } from './altaAplicar.mjs';

/* [por que] `--json` lo usa el tablero (F10): solo estado por ítem, sin el contenido de
 * las acciones. Pendientes = código 1, que es un resultado normal y no un fallo. */
export async function alta(argv, raiz = RAIZ) {
  const aplicar = argv.includes('--aplicar');
  const json = argv.includes('--json');
  const objetivo = argv.find((a) => !a.startsWith('--'));
  if (!objetivo) {
    console.error('uso: alta <id|carpeta> [--aplicar] [--json]');
    return 1;
  }
  if (aplicar && json) {
    console.error('alta: --json no combina con --aplicar');
    return 1;
  }
  try {
    const registro = JSON.parse(readFileSync(rutaConfigPrivada('registro.json', raiz), 'utf8'));
    const porId = registro.proyectos.find((x) => x.id === objetivo);
    const ruta = porId ? resolve(raiz, porId.ruta) : resolve(objetivo);
    if (!existsSync(ruta)) {
      console.error(`alta: no existe ${objetivo}`);
      return 1;
    }
    const entrada = porId ?? registro.proyectos.find((x) => norma(resolve(raiz, x.ruta)) === norma(ruta));
    const etiqueta = entrada?.id ?? basename(ruta);

    let items = comprobarAlta(ruta, entrada, etiqueta);
    if (aplicar) {
      for (const linea of aplicarAlta(ruta, items)) console.log(`→ ${linea}`);
      items = comprobarAlta(ruta, entrada, etiqueta);
    }
    const hechos = items.filter((it) => it.ok).length;
    const pendientes = items.length - hechos;
    if (json) {
      const planos = items.map(({ nombre, ok, detalle, accion }) => ({ nombre, ok, detalle, accion }));
      console.log(JSON.stringify({ etiqueta, hechos, total: items.length, items: planos }));
      return pendientes === 0 ? 0 : 1;
    }
    for (const it of items) {
      console.log(`${it.ok ? '✓' : '✗'} ${it.nombre} — ${it.detalle}`);
      if (!it.ok) console.log(`    → ${it.accion}`);
    }
    console.log(`alta ${etiqueta}: ${hechos}/${items.length}${pendientes ? ` (${pendientes} pendiente(s))` : ': completa'}`);
    return pendientes === 0 ? 0 : 1;
  } catch (e) {
    console.error(`alta: ${e?.message ?? e}`);
    return 1;
  }
}
