/* Plantilla de guard por stack (F11.4): `guard-plantillas.json` de la config
 * privada. La pestaña Guardián la aplica a cada proyecto según su
 * `stackDeProyecto` y la edita con el mismo escritor seguro que la política.
 * [por que] Se valida con las reglas de las listas (validarEntradas) para que una
 * plantilla mal escrita no llegue a sentinel.config.json. Se serializa con listas
 * inline, como el fichero real: con JSON.stringify la vista previa mostraría un
 * reformateo completo en vez de los cambios de verdad. */
import { join } from 'node:path';
import { diffLineas, eolDe, escribirAtomico, hashDe, leerFichero, type BloqueDiff, type Eol } from '../escritura.js';
import { esObjeto } from '../../../shared/guardas.js';
import { ErrorValidacion, LISTAS_GUARD, validarEntradas, type Listas, type Plantilla } from './politica.js';

/* Nombre del fichero dentro de la config privada. [por que] La plantilla lleva la
 * lista de proyectos del area, asi que no puede vivir en el repo: es la misma
 * config privada que el registro y la ficha del taller (ver server/plataforma/rutas.ts). */
export const NOMBRE_PLANTILLA = 'guard-plantillas.json';

export type LecturaPlantilla =
  | { estado: 'ausente' }
  | { estado: 'invalida'; motivo: string; hash: string | null }
  | { estado: 'ok'; plantilla: Plantilla; contenido: string; hash: string };

export type ResultadoPlantilla = { ok: true; plantilla: Plantilla } | { ok: false; motivo: string };

/* Mismas reglas que validarPolitica: lo que no encaja se rechaza con motivo. */
export function validarPlantilla(json: unknown): ResultadoPlantilla {
  if (!esObjeto(json)) return { ok: false, motivo: 'la raíz no es un objeto JSON' };
  if (json.schemaVersion !== 1) return { ok: false, motivo: `schemaVersion ${String(json.schemaVersion)} no soportada (solo 1)` };
  try {
    if (json.descripcion !== undefined && typeof json.descripcion !== 'string') {
      throw new ErrorValidacion('descripcion debe ser texto');
    }
    const quitarDeTools = validarEntradas(json.quitarDeTools, 'quitarDeTools');
    if (!esObjeto(json.plantillas)) throw new ErrorValidacion('plantillas debe ser un objeto');
    const plantillas: Record<string, Partial<Listas>> = {};
    for (const [stack, bloque] of Object.entries(json.plantillas)) {
      validarEntradas([stack], 'nombre de stack');
      if (!esObjeto(bloque)) throw new ErrorValidacion(`la plantilla ${stack} debe ser un objeto`);
      const listas: Partial<Listas> = {};
      for (const [clave, valor] of Object.entries(bloque)) {
        if (!LISTAS_GUARD.includes(clave as (typeof LISTAS_GUARD)[number])) {
          throw new ErrorValidacion(`plantilla ${stack}: lista desconocida ${clave}`);
        }
        listas[clave as keyof Listas] = validarEntradas(valor, `${stack}.${clave}`);
      }
      plantillas[stack] = listas;
    }
    if (!esObjeto(json.stackDeProyecto)) throw new ErrorValidacion('stackDeProyecto debe ser un objeto');
    const stackDeProyecto: Record<string, string[]> = {};
    for (const [proyecto, valor] of Object.entries(json.stackDeProyecto)) {
      /* [por que] Las claves son nombres de carpeta (pueden llevar espacios): no se
       * validan con el patrón de entradas, solo que no estén vacías ni sean enormes. */
      if (!proyecto || proyecto.length > 200) throw new ErrorValidacion('nombre de proyecto no válido');
      const stacks = validarEntradas(valor, `stackDeProyecto.${proyecto}`);
      for (const s of stacks) {
        if (!Object.prototype.hasOwnProperty.call(plantillas, s)) {
          throw new ErrorValidacion(`stackDeProyecto.${proyecto}: el stack ${s} no tiene plantilla`);
        }
      }
      stackDeProyecto[proyecto] = stacks;
    }
    return {
      ok: true,
      plantilla: {
        schemaVersion: 1,
        ...(typeof json.descripcion === 'string' ? { descripcion: json.descripcion } : {}),
        quitarDeTools,
        plantillas,
        stackDeProyecto,
      },
    };
  } catch (err) {
    if (err instanceof ErrorValidacion) return { ok: false, motivo: err.message };
    throw err;
  }
}

/* Serializa con el estilo del fichero real: sangría de 2 y listas inline. El
 * último salto de línea sigue al del texto original (ver leerPlantilla). */
export function serializarPlantilla(p: Plantilla, eol: Eol): string {
  const lista = (xs: string[]): string => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;
  const lineas: string[] = ['{', '  "schemaVersion": 1,'];
  if (p.descripcion !== undefined) lineas.push(`  "descripcion": ${JSON.stringify(p.descripcion)},`);
  lineas.push(`  "quitarDeTools": ${lista(p.quitarDeTools)},`);

  const stacks = Object.entries(p.plantillas);
  if (stacks.length === 0) lineas.push('  "plantillas": {},');
  else {
    lineas.push('  "plantillas": {');
    stacks.forEach(([stack, listas], i) => {
      lineas.push(`    ${JSON.stringify(stack)}: {`);
      const claves = Object.entries(listas);
      claves.forEach(([clave, valores], j) => {
        lineas.push(`      ${JSON.stringify(clave)}: ${lista(valores ?? [])}${j < claves.length - 1 ? ',' : ''}`);
      });
      lineas.push(`    }${i < stacks.length - 1 ? ',' : ''}`);
    });
    lineas.push('  },');
  }

  const proyectos = Object.entries(p.stackDeProyecto);
  if (proyectos.length === 0) lineas.push('  "stackDeProyecto": {}');
  else {
    lineas.push('  "stackDeProyecto": {');
    proyectos.forEach(([proyecto, stacksDe], i) => {
      lineas.push(`    ${JSON.stringify(proyecto)}: ${lista(stacksDe)}${i < proyectos.length - 1 ? ',' : ''}`);
    });
    lineas.push('  }');
  }
  lineas.push('}');
  return lineas.join(eol) + eol;
}

/* Lee y valida la plantilla del tablero. Symlink o carpeta → inválida. */
export function leerPlantilla(dirConfig: string): LecturaPlantilla {
  const lectura = leerFichero(join(dirConfig, NOMBRE_PLANTILLA));
  if (lectura.estado === 'ausente') return { estado: 'ausente' };
  if (lectura.estado === 'invalido') return { estado: 'invalida', motivo: lectura.motivo, hash: null };
  let json: unknown;
  try {
    json = JSON.parse(lectura.contenido);
  } catch {
    return { estado: 'invalida', motivo: 'JSON no válido', hash: lectura.hash };
  }
  const v = validarPlantilla(json);
  if (!v.ok) return { estado: 'invalida', motivo: v.motivo, hash: lectura.hash };
  return { estado: 'ok', plantilla: v.plantilla, contenido: lectura.contenido, hash: lectura.hash };
}

export type ResultadoEdicionPlantilla =
  | { estado: 'ok'; cambia: boolean; diff: BloqueDiff | null; hash: string; plantilla: Plantilla }
  | { estado: 'conflicto'; motivo: string }
  | { estado: 'error'; motivo: string };

type PlanPlantilla =
  | { estado: 'ok'; lectura: Extract<LecturaPlantilla, { estado: 'ok' }>; nuevo: string; cambia: boolean; diff: BloqueDiff | null; plantilla: Plantilla }
  | { estado: 'conflicto'; motivo: string }
  | { estado: 'error'; motivo: string };

function planificar(dirConfig: string, hashPrevio: string, entrada: unknown): PlanPlantilla {
  const lectura = leerPlantilla(dirConfig);
  if (lectura.estado !== 'ok') {
    return { estado: 'error', motivo: lectura.estado === 'ausente' ? `falta ${NOMBRE_PLANTILLA}` : lectura.motivo };
  }
  if (lectura.hash !== hashPrevio) {
    return { estado: 'conflicto', motivo: 'la plantilla cambió desde que se leyó; recarga la página' };
  }
  const v = validarPlantilla(entrada);
  if (!v.ok) return { estado: 'error', motivo: v.motivo };
  const nuevo = serializarPlantilla(v.plantilla, eolDe(lectura.contenido));
  const cambia = nuevo !== lectura.contenido;
  return { estado: 'ok', lectura, nuevo, cambia, diff: cambia ? diffLineas(lectura.contenido, nuevo) : null, plantilla: v.plantilla };
}

function publico(p: Extract<PlanPlantilla, { estado: 'ok' }>): ResultadoEdicionPlantilla {
  return { estado: 'ok', cambia: p.cambia, diff: p.diff, hash: hashDe(p.nuevo), plantilla: p.plantilla };
}

/* Vista previa sin escribir. */
export function calcularEdicionPlantilla(dirConfig: string, hashPrevio: string, entrada: unknown): ResultadoEdicionPlantilla {
  const p = planificar(dirConfig, hashPrevio, entrada);
  if (p.estado !== 'ok') return p;
  return publico(p);
}

/* Escritura atómica. Relee antes de escribir: si el fichero cambió desde el
 * cálculo, no se pisa. Sin cambios, no toca el fichero. */
export function guardarEdicionPlantilla(dirConfig: string, hashPrevio: string, entrada: unknown): ResultadoEdicionPlantilla {
  const p = planificar(dirConfig, hashPrevio, entrada);
  if (p.estado !== 'ok') return p;
  if (!p.cambia) return publico(p);
  const ahora = leerPlantilla(dirConfig);
  if (ahora.estado !== 'ok' || ahora.hash !== p.lectura.hash) {
    return { estado: 'conflicto', motivo: 'la plantilla cambió mientras se calculaba la edición; recarga la página' };
  }
  escribirAtomico(join(dirConfig, NOMBRE_PLANTILLA), p.nuevo);
  return publico(p);
}
