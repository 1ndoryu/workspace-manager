/* Avisos de esquema de un archivo del gate (puro: solo cruza el catalogo con el diagnostico).
 * [por que aparte] Sin E/S se prueba con un JSON cualquiera; la escritura del archivo vive en
 * rutasGate-escritura.ts y lo usa para decidir que avisos devolver. */
import { esquemaPorArchivo } from '../../../shared/gate/catalogo/esquemas.js';
import { diagnosticar, rutaEtiqueta, severidadDe } from '../../../shared/gate/modelo/esquema.js';

/* Avisos del diagnóstico contra el esquema curado del archivo (vacío si no tiene). */
export function avisosDeEsquema(nombre: string, valor: unknown) {
  const esquema = esquemaPorArchivo(nombre) ?? null;
  if (!esquema) return [];
  return diagnosticar(esquema, valor)
    .map((f) => ({ ruta: rutaEtiqueta(f.ruta), severidad: severidadDe(f) }))
    .filter((a) => a.severidad !== null);
}
