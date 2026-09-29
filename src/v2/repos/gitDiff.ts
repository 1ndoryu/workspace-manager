/* Lógica de diffs por archivo para el lateral de la tab repos (299A-4).
 * [por que] Copiada de glory-harness
 * (`desktop/ui/src/componentes/gitDiff.ts`): el servidor sirve los diffs
 * combinados por grupo (staged/unstaged) y el cliente los reparte por
 * archivo indicándolos por su ruta `+++ b/`. Solo la parte pura (sin DOM:
 * aquí se renderiza con React en PanelCambiosRepo). */
import type { EntradaCambio } from '../../shared/types.js';

export type GrupoCambios = 'staged' | 'changes';

export interface ArchivoCambio {
  estado: string;
  ruta: string;
  patch: string;
  adiciones: number;
  eliminaciones: number;
}

/* Reparte las entradas del porcelain entre staged (columna X) y changes
 * (columna Y o untracked), buscando el patch de cada una en su diff. */
export function separarEntradas(
  entradas: EntradaCambio[],
  diffStaged: string,
  diffUnstaged: string,
): { staged: ArchivoCambio[]; changes: ArchivoCambio[] } {
  const patchesStaged = indexarPatches(diffStaged);
  const patchesUnstaged = indexarPatches(diffUnstaged);
  const staged: ArchivoCambio[] = [];
  const changes: ArchivoCambio[] = [];

  for (const entrada of entradas) {
    const indice = entrada.estado[0] ?? ' ';
    const trabajo = entrada.estado[1] ?? ' ';
    if (indice !== ' ' && indice !== '?') {
      staged.push(crearArchivo(entrada, patchesStaged.get(entrada.ruta) ?? ''));
    }
    if (trabajo !== ' ' || entrada.estado === '??') {
      changes.push(crearArchivo(entrada, patchesUnstaged.get(entrada.ruta) ?? ''));
    }
  }
  return { staged, changes };
}

function crearArchivo(entrada: EntradaCambio, patch: string): ArchivoCambio {
  const estadistica = contarCambios(patch);
  return {
    estado: entrada.estado,
    ruta: entrada.ruta,
    patch,
    adiciones: estadistica.adiciones,
    eliminaciones: estadistica.eliminaciones,
  };
}

/* Índice ruta → patch: cada bloque empieza en `diff --git ` y su ruta se
 * lee de `+++ b/` (o `--- a/` si es borrado). */
function indexarPatches(diff: string): Map<string, string> {
  const resultado = new Map<string, string>();
  if (!diff.trim()) return resultado;
  const bloques = diff.split(/^diff --git /m).slice(1);
  for (const bloque of bloques) {
    const patch = `diff --git ${bloque}`;
    const ruta = rutaDelPatch(patch);
    if (ruta) resultado.set(ruta, patch.trimEnd());
  }
  return resultado;
}

function rutaDelPatch(patch: string): string | null {
  const nueva = patch.match(/^\+\+\+ b\/(.*)$/m)?.[1];
  if (nueva && nueva !== '/dev/null') return normalizarRuta(nueva);
  const antigua = patch.match(/^--- a\/(.*)$/m)?.[1];
  return antigua && antigua !== '/dev/null' ? normalizarRuta(antigua) : null;
}

function normalizarRuta(ruta: string): string {
  return ruta.replaceAll('\\', '/').trim();
}

/* +/− por línea del patch, sin contar las cabeceras `+++`/`---`. */
function contarCambios(patch: string): { adiciones: number; eliminaciones: number } {
  let adiciones = 0;
  let eliminaciones = 0;
  for (const linea of patch.split(/\r?\n/)) {
    if (linea.startsWith('+++') || linea.startsWith('---')) continue;
    if (linea.startsWith('+')) adiciones += 1;
    else if (linea.startsWith('-')) eliminaciones += 1;
  }
  return { adiciones, eliminaciones };
}

export function sumarCambios(archivos: ArchivoCambio[]): {
  adiciones: number;
  eliminaciones: number;
} {
  return archivos.reduce(
    (total, archivo) => ({
      adiciones: total.adiciones + archivo.adiciones,
      eliminaciones: total.eliminaciones + archivo.eliminaciones,
    }),
    { adiciones: 0, eliminaciones: 0 },
  );
}

/* Código visible del estado en su grupo (como harness `estadoVisible`):
 * `??` = `?`; en staged se muestra la columna X, en changes la Y. */
export function estadoVisible(estado: string, grupo: GrupoCambios): string {
  const indice = estado[0] ?? ' ';
  const trabajo = estado[1] ?? ' ';
  if (estado === '??') return '?';
  return grupo === 'staged' ? indice : trabajo;
}
