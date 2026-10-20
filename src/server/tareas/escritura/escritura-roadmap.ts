/* Escritura segura del roadmap (20AA-10 F3): copia previa, rastro y escritura atomica.
 * [por que] Es el unico sitio del proyecto que escribe dentro de un proyecto ajeno, asi que cada
 * escritura deja copia verificada y linea de historial: si algo sale mal, se puede volver atras y
 * se puede saber quien cambio que. Las copias y el historial viven en `data/` del manager (no se
 * versiona: un roadmap lleva nombres de proyectos privados), nunca dentro del proyecto tocado. */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/* Ultimas copias que se conservan por proyecto, y tope del historial (rota a un unico `.1`, como
 * la auditoria de la API). */
export const TOPE_COPIAS = 50;
export const TAMANO_MAX_HISTORIAL = 1024 * 1024;

export type OrigenCambio = 'roadmap' | 'task' | 'puente' | 'conflicto';

export interface EntradaHistorial {
  at: string;
  tarea: string;
  origen: OrigenCambio;
  campo: string;
  antes: string | null;
  despues: string | null;
  /* `roadmap.md:42` cuando se sabe. */
  sitio: string | null;
  autor: 'usuaria' | 'agente' | 'puente';
}

export function dirRespaldos(raizRepo: string): string {
  return join(raizRepo, 'data', 'respaldos-roadmap');
}

export function dirHistorial(raizRepo: string): string {
  return join(raizRepo, 'data', 'historial-roadmap');
}

export function hashTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/* Sello `YYYYMMDD-HHMMSS` en hora local: es lo que ordena las copias de un proyecto. */
function sello(ahora: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}` +
    `-${p(ahora.getHours())}${p(ahora.getMinutes())}${p(ahora.getSeconds())}`
  );
}

/* Copia el archivo antes de tocarlo, con su hash releido y verificado, y anota la copia en el
 * indice. Devuelve la ruta de la copia y su hash. */
export function copiaPrevia(
  raizRepo: string,
  proyecto: string,
  rutaArchivo: string,
  texto: string,
  ahora: Date,
): { ruta: string; hash: string } {
  const carpeta = join(dirRespaldos(raizRepo), proyecto);
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, `${sello(ahora)}-roadmap.md`);
  const hash = hashTexto(texto);
  writeFileSync(ruta, texto, 'utf8');
  /* [por que] Se relee: una copia que no se puede verificar no es una copia, y este es el unico
   * seguro antes de tocar el archivo. */
  const vuelta = readFileSync(ruta, 'utf8');
  if (hashTexto(vuelta) !== hash) throw new Error(`copia no verificada: ${ruta}`);
  const indice = join(dirRespaldos(raizRepo), 'indice.ndjson');
  appendFileSync(indice, `${JSON.stringify({ at: ahora.toISOString(), proyecto, archivo: rutaArchivo, copia: ruta, hash })}\n`, 'utf8');
  podarCopias(carpeta);
  return { ruta, hash };
}

/* Deja las ultimas TOPE_COPIAS del proyecto: el disco no crece sin limite. */
export function podarCopias(carpeta: string): void {
  let copias: string[];
  try {
    copias = readdirSync(carpeta).filter((n) => n.endsWith('-roadmap.md'));
  } catch {
    return;
  }
  if (copias.length <= TOPE_COPIAS) return;
  for (const vieja of copias.sort().slice(0, copias.length - TOPE_COPIAS)) {
    try {
      unlinkSync(join(carpeta, vieja));
    } catch {
      /* Si no se puede borrar, se queda: molesta menos que perder una copia. */
    }
  }
}

/* El rastro: una linea por cambio, en el ndjson del proyecto. */
export function apuntarHistorial(raizRepo: string, proyecto: string, entradas: EntradaHistorial[]): string {
  const carpeta = dirHistorial(raizRepo);
  mkdirSync(carpeta, { recursive: true });
  const archivo = join(carpeta, `${proyecto}.ndjson`);
  const tamano = statSync(archivo, { throwIfNoEntry: false })?.size ?? 0;
  if (tamano > TAMANO_MAX_HISTORIAL) renameSync(archivo, `${archivo}.1`);
  appendFileSync(archivo, entradas.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return archivo;
}

/* Escritura atomica: temporal + rename, con el hash del original como guarda. [por que] Si el
 * archivo cambio entre la lectura y la escritura, se aborta: escribir encima perderia esa edicion,
 * y el rename es lo que evita dejar un roadmap a medias si el proceso muere. */
export function escribirAtomico(ruta: string, texto: string, hashEsperado: string): void {
  const actual = readFileSync(ruta, 'utf8');
  if (hashTexto(actual) !== hashEsperado) throw new Error('archivo-cambio: el roadmap cambio entre la lectura y la escritura');
  const temporal = `${ruta}.puente-${process.pid}.tmp`;
  writeFileSync(temporal, texto, 'utf8');
  renameSync(temporal, ruta);
  if (hashTexto(readFileSync(ruta, 'utf8')) !== hashTexto(texto)) {
    throw new Error('escritura-no-verificada: el roadmap no quedo como se escribio');
  }
}
